import { withFilter } from 'graphql-subscriptions';
import * as R from 'ramda';
import { BUS_TOPICS } from '../config/conf';
import {
  findAll,
  findById,
  stixDomainObjectsNumber,
  stixDomainObjectsDistributionByEntity,
  stixDomainObjectsTimeSeries,
  addStixDomainObject,
  stixDomainObjectAddRelation,
  stixDomainObjectAddRelations,
  stixDomainObjectCleanContext,
  stixDomainObjectDelete,
  stixDomainObjectsDelete,
  stixDomainObjectDeleteRelation,
  stixDomainObjectEditContext,
  stixDomainObjectEditField,
  stixDomainObjectExportAsk,
  stixDomainObjectExportPush,
  stixDomainObjectsExportPush,
  stixDomainObjectsExportAsk,
  stixDomainObjectsTimeSeriesByAuthor,
} from '../domain/stixDomainObject';
import { findById as findStatusById, findByType } from '../domain/status';
import { pubsub } from '../database/redis';
import withCancel from '../graphql/subscriptionWrapper';
import { filesListing } from '../database/file-storage';
import { ABSTRACT_STIX_DOMAIN_OBJECT } from '../schema/general';
import { stixDomainObjectOptions } from '../schema/stixDomainObject';
import { stixCoreObjectImportPush } from '../domain/stixCoreObject';

const stixDomainObjectResolvers = {
  Query: {
    stixDomainObject: (_, { id }, context) => findById(context, context.user, id),
    stixDomainObjects: (_, args, context) => findAll(context, context.user, args),
    stixDomainObjectsTimeSeries: (_, args, context) => {
      if (args.authorId && args.authorId.length > 0) {
        return stixDomainObjectsTimeSeriesByAuthor(context, context.user, args);
      }
      return stixDomainObjectsTimeSeries(context, context.user, args);
    },
    stixDomainObjectsNumber: (_, args, context) => stixDomainObjectsNumber(context, context.user, args),
    stixDomainObjectsDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return stixDomainObjectsDistributionByEntity(context, context.user, args);
      }
      return [];
    },
    stixDomainObjectsExportFiles: (_, { type, first }, context) => filesListing(context, context.user, first, `export/${type}/`),
  },
  StixDomainObjectsFilter: stixDomainObjectOptions.StixDomainObjectsFilter,
  StixDomainObject: {
    __resolveType(obj) {
      if (obj.entity_type) {
        return obj.entity_type.replace(/(?:^|-)(\w)/g, (matches, letter) => letter.toUpperCase());
      }
      return 'Unknown';
    },
    importFiles: (entity, { first }, context) => filesListing(context, context.user, first, `import/${entity.entity_type}/${entity.id}/`),
    exportFiles: (entity, { first }, context) => filesListing(context, context.user, first, `export/${entity.entity_type}/${entity.id}/`),
    status: (entity, _, context) => (entity.x_opencti_workflow_id ? findStatusById(context, context.user, entity.x_opencti_workflow_id) : null),
    workflowEnabled: async (entity, _, context) => {
      const statusesType = await findByType(context, context.user, entity.entity_type);
      return statusesType.length > 0;
    },
  },
  Mutation: {
    stixDomainObjectEdit: (_, { id }, context) => ({
      delete: () => stixDomainObjectDelete(context, context.user, id),
      fieldPatch: ({ input, commitMessage, references }) => stixDomainObjectEditField(context, context.user, id, input, { commitMessage, references }),
      contextPatch: ({ input }) => stixDomainObjectEditContext(context, context.user, id, input),
      contextClean: () => stixDomainObjectCleanContext(context, context.user, id),
      relationAdd: ({ input }) => stixDomainObjectAddRelation(context, context.user, id, input),
      relationsAdd: ({ input }) => stixDomainObjectAddRelations(context, context.user, id, input),
      relationDelete: ({ toId, relationship_type: relationshipType }) => stixDomainObjectDeleteRelation(context, context.user, id, toId, relationshipType),
      importPush: ({ file, noTriggerImport = false }) => stixCoreObjectImportPush(context, context.user, id, file, noTriggerImport),
      exportAsk: (args) => stixDomainObjectExportAsk(context, context.user, R.assoc('stixDomainObjectId', id, args)),
      exportPush: ({ file }) => stixDomainObjectExportPush(context, context.user, id, file),
    }),
    stixDomainObjectsDelete: (_, { id }, context) => stixDomainObjectsDelete(context, context.user, id),
    stixDomainObjectAdd: (_, { input }, context) => addStixDomainObject(context, context.user, input),
    stixDomainObjectsExportAsk: (_, args, context) => stixDomainObjectsExportAsk(context, context.user, args),
    stixDomainObjectsExportPush: (_, { type, file, listFilters }, context) => stixDomainObjectsExportPush(context, context.user, type, file, listFilters),
  },
  Subscription: {
    stixDomainObject: {
      resolve: /* istanbul ignore next */ (payload) => payload.instance,
      subscribe: /* istanbul ignore next */ (_, { id }, context) => {
        stixDomainObjectEditContext(context, context.user, id);
        const filtering = withFilter(
          () => pubsub.asyncIterator(BUS_TOPICS[ABSTRACT_STIX_DOMAIN_OBJECT].EDIT_TOPIC),
          (payload) => {
            if (!payload) return false; // When disconnect, an empty payload is dispatched.
            return payload.user.id !== context.user.id && payload.instance.id === id;
          }
        )(_, { id }, context);
        return withCancel(filtering, () => {
          stixDomainObjectCleanContext(context, context.user, id);
        });
      },
    },
  },
};

export default stixDomainObjectResolvers;
