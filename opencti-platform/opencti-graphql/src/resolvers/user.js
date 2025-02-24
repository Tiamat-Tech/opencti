import * as R from 'ramda';
import { withFilter } from 'graphql-subscriptions';
import {
  addUser,
  batchGroups,
  batchRoleCapabilities,
  batchRoles,
  fetchSessionTtl,
  findAll,
  findById,
  findCapabilities,
  findRoleById,
  findRoles,
  findSessions,
  findUserSessions,
  getCapabilities,
  getMarkings,
  killSession,
  killUserSessions,
  logout,
  meEditField,
  roleAddRelation,
  roleCleanContext,
  roleDelete,
  roleDeleteRelation,
  roleEditContext,
  roleEditField,
  userAddRelation,
  userCleanContext,
  userDelete,
  userIdDeleteRelation,
  userEditContext,
  userEditField,
  userWithOrigin,
  bookmarks,
  addBookmark,
  deleteBookmark,
  userRenewToken,
  authenticateUser,
  otpUserGeneration,
  otpUserLogin,
  otpUserActivation, otpUserDeactivation,
} from '../domain/user';
import { BUS_TOPICS, logApp, logAudit } from '../config/conf';
import passport, { PROVIDERS } from '../config/providers';
import { AuthenticationFailure } from '../config/errors';
import { addRole } from '../domain/grant';
import { fetchEditContext, pubsub } from '../database/redis';
import withCancel from '../graphql/subscriptionWrapper';
import { ENTITY_TYPE_USER } from '../schema/internalObject';
import { batchLoader } from '../database/middleware';
import { LOGIN_ACTION } from '../config/audit';
import { getUserSubscriptions } from '../domain/userSubscription';
import { executionContext } from '../utils/access';

const groupsLoader = batchLoader(batchGroups);
const rolesLoader = batchLoader(batchRoles);
const rolesCapabilitiesLoader = batchLoader(batchRoleCapabilities);

const userResolvers = {
  Query: {
    user: (_, { id }, context) => findById(context, context.user, id),
    otpGeneration: (_, __, context) => otpUserGeneration(context.user),
    users: (_, args, context) => findAll(context, context.user, args),
    role: (_, { id }, context) => findRoleById(context, context.user, id),
    roles: (_, args, context) => findRoles(context, context.user, args),
    sessions: () => findSessions(),
    capabilities: (_, args, context) => findCapabilities(context, context.user, args),
    me: (_, args, context) => findById(context, context.user, context.user.id),
    bookmarks: (_, { types }, context) => bookmarks(context, context.user, types),
  },
  User: {
    groups: (current, _, context) => groupsLoader.load(current.id, context, context.user),
    roles: (current, _, context) => rolesLoader.load(current.id, context, context.user),
    allowed_marking: (current, _, context) => getMarkings(context, current.id, context.user.capabilities),
    capabilities: (current, _, context) => getCapabilities(context, current.id),
    editContext: (current) => fetchEditContext(current.id),
    sessions: (current) => findUserSessions(current.id),
    userSubscriptions: (current, _, context) => getUserSubscriptions(context, context.user, current.id),
  },
  MeUser: {
    capabilities: (current, _, context) => getCapabilities(context, current.id),
    userSubscriptions: (current, _, context) => getUserSubscriptions(context, context.user, current.id),
  },
  UserSession: {
    user: (session, _, context) => findById(context, context.user, session.user_id),
  },
  SessionDetail: {
    ttl: (session) => fetchSessionTtl(session),
  },
  Role: {
    editContext: (role) => fetchEditContext(role.id),
    capabilities: (role, _, context) => rolesCapabilitiesLoader.load(role.id, context, context.user),
  },
  Mutation: {
    otpActivation: (_, { input }, context) => otpUserActivation(context, context.user, input),
    otpDeactivation: (_, __, context) => otpUserDeactivation(context, context.user, context.user.id),
    otpLogin: (_, { input }, { req, user }) => otpUserLogin(req, user, input),
    token: async (_, { input }, { req }) => {
      // We need to iterate on each provider to find one that validated the credentials
      const formProviders = R.filter((p) => p.type === 'FORM', PROVIDERS);
      if (formProviders.length === 0) {
        logApp.warn('[AUTH] Cant authenticate without any form providers');
      }
      let loggedUser;
      for (let index = 0; index < formProviders.length; index += 1) {
        const auth = formProviders[index];
        const body = { username: input.email, password: input.password };
        const { user, provider } = await new Promise((resolve) => {
          passport.authenticate(auth.provider, {}, (err, authUser, info) => {
            if (err || info) {
              logApp.warn(`[AUTH] ${auth.provider}`, { error: err, info });
              const auditUser = userWithOrigin(req, { user_email: input.email });
              logAudit.error(auditUser, LOGIN_ACTION, { provider: auth.provider });
            }
            resolve({ user: authUser, provider: auth.provider });
          })({ body });
        });
        // As soon as credential is validated, stop looking for another provider
        if (user) {
          const context = executionContext(`${provider}_strategy`);
          loggedUser = await authenticateUser(context, req, user, provider);
          break;
        }
      }
      if (loggedUser) {
        return loggedUser.api_token;
      }
      // User cannot be authenticated in any providers
      throw AuthenticationFailure();
    },
    sessionKill: (_, { id }) => killSession(id),
    otpUserDeactivation: (_, { id }, context) => otpUserDeactivation(context, context.user, id),
    userSessionsKill: (_, { id }) => killUserSessions(id),
    logout: (_, args, context) => logout(context.user, context.req, context.res),
    roleEdit: (_, { id }, context) => ({
      delete: () => roleDelete(context, context.user, id),
      fieldPatch: ({ input }) => roleEditField(context, context.user, id, input),
      contextPatch: ({ input }) => roleEditContext(context, context.user, id, input),
      contextClean: () => roleCleanContext(context, context.user, id),
      relationAdd: ({ input }) => roleAddRelation(context, context.user, id, input),
      relationDelete: ({ toId, relationship_type: relationshipType }) => roleDeleteRelation(context, context.user, id, toId, relationshipType),
    }),
    roleAdd: (_, { input }, context) => addRole(context, context.user, input),
    userEdit: (_, { id }, context) => ({
      delete: () => userDelete(context, context.user, id),
      fieldPatch: ({ input }) => userEditField(context, context.user, id, input),
      contextPatch: ({ input }) => userEditContext(context, context.user, id, input),
      contextClean: () => userCleanContext(context, context.user, id),
      tokenRenew: () => userRenewToken(context, context.user, id),
      relationAdd: ({ input }) => userAddRelation(context, context.user, id, input),
      relationDelete: ({ toId, relationship_type: relationshipType }) => userIdDeleteRelation(context, context.user, id, toId, relationshipType),
    }),
    meEdit: (_, { input, password }, context) => meEditField(context, context.user, context.user.id, input, password),
    meTokenRenew: (_, __, context) => userRenewToken(context, context.user, context.user.id),
    userAdd: (_, { input }, context) => addUser(context, context.user, input),
    bookmarkAdd: (_, { id, type }, context) => addBookmark(context, context.user, id, type),
    bookmarkDelete: (_, { id }, context) => deleteBookmark(context, context.user, id),
  },
  Subscription: {
    user: {
      resolve: /* istanbul ignore next */ (payload) => payload.instance,
      subscribe: /* istanbul ignore next */ (_, { id }, context) => {
        userEditContext(context, context.user, id);
        const filtering = withFilter(
          () => pubsub.asyncIterator(BUS_TOPICS[ENTITY_TYPE_USER].EDIT_TOPIC),
          (payload) => {
            if (!payload) return false; // When disconnect, an empty payload is dispatched.
            return payload.user.id !== context.user.id && payload.instance.id === id;
          }
        )(_, { id }, context);
        return withCancel(filtering, () => {
          userCleanContext(context, context.user, id);
        });
      },
    },
  },
};

export default userResolvers;
