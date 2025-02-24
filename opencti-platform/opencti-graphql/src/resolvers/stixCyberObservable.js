import { withFilter } from 'graphql-subscriptions';
import { assoc } from 'ramda';
import { BUS_TOPICS } from '../config/conf';
import {
  addStixCyberObservable,
  findAll,
  findById,
  batchIndicators,
  stixCyberObservableAddRelation,
  stixCyberObservableAddRelations,
  stixCyberObservableCleanContext,
  stixCyberObservableDelete,
  stixCyberObservableDeleteRelation,
  stixCyberObservableEditContext,
  stixCyberObservableEditField,
  stixCyberObservablesNumber,
  stixCyberObservablesTimeSeries,
  stixCyberObservableExportAsk,
  stixCyberObservableExportPush,
  stixCyberObservableDistribution,
  stixCyberObservableDistributionByEntity,
  stixCyberObservablesExportPush,
  stixCyberObservablesExportAsk,
  promoteObservableToIndicator,
  artifactImport,
  batchVulnerabilities
} from '../domain/stixCyberObservable';
import { pubsub } from '../database/redis';
import withCancel from '../graphql/subscriptionWrapper';
import { stixCoreObjectImportPush, stixCoreRelationships } from '../domain/stixCoreObject';
import { filesListing } from '../database/file-storage';
import { ABSTRACT_STIX_CYBER_OBSERVABLE } from '../schema/general';
import { stixHashesToInput } from '../schema/fieldDataAdapter';
import { stixCyberObservableOptions } from '../schema/stixCyberObservable';
import { batchLoader, stixLoadByIdStringify } from '../database/middleware';
import { observableValue } from '../utils/format';

const indicatorsLoader = batchLoader(batchIndicators);
const vulnerabilitiesLoader = batchLoader(batchVulnerabilities);

const stixCyberObservableResolvers = {
  Query: {
    stixCyberObservable: (_, { id }, context) => findById(context, context.user, id),
    stixCyberObservables: (_, args, context) => findAll(context, context.user, args),
    stixCyberObservablesTimeSeries: (_, args, context) => stixCyberObservablesTimeSeries(context, context.user, args),
    stixCyberObservablesNumber: (_, args, context) => stixCyberObservablesNumber(context, context.user, args),
    stixCyberObservablesDistribution: (_, args, context) => {
      if (args.objectId && args.objectId.length > 0) {
        return stixCyberObservableDistributionByEntity(context, context.user, args);
      }
      return stixCyberObservableDistribution(context, context.user, args);
    },
    stixCyberObservablesExportFiles: (_, { first }, context) => filesListing(context, context.user, first, 'export/Stix-Cyber-Observable/'),
  },
  StixCyberObservablesFilter: stixCyberObservableOptions.StixCyberObservablesFilter,
  HashedObservable: {
    hashes: (stixCyberObservable) => stixHashesToInput(stixCyberObservable),
  },
  StixCyberObservable: {
    __resolveType(obj) {
      if (obj.entity_type) {
        return obj.entity_type.replace(/(?:^|-)(\w)/g, (matches, letter) => letter.toUpperCase());
      }
      return 'Unknown';
    },
    observable_value: (stixCyberObservable) => observableValue(stixCyberObservable),
    indicators: (stixCyberObservable, _, context) => indicatorsLoader.load(stixCyberObservable.id, context, context.user),
    stixCoreRelationships: (rel, args, context) => stixCoreRelationships(context, context.user, rel.id, args),
    toStix: (stixCyberObservable, _, context) => stixLoadByIdStringify(context, context.user, stixCyberObservable.id),
    importFiles: (stixCyberObservable, { first }, context) => filesListing(context, context.user, first, `import/${stixCyberObservable.entity_type}/${stixCyberObservable.id}/`),
    exportFiles: (stixCyberObservable, { first }, context) => filesListing(context, context.user, first, `export/${stixCyberObservable.entity_type}/${stixCyberObservable.id}/`),
  },
  Software: {
    vulnerabilities: (software, _, context) => vulnerabilitiesLoader.load(software.id, context, context.user),
  },
  Mutation: {
    stixCyberObservableEdit: (_, { id }, context) => ({
      delete: () => stixCyberObservableDelete(context, context.user, id),
      fieldPatch: ({ input, commitMessage, references }) => stixCyberObservableEditField(context, context.user, id, input, { commitMessage, references }),
      contextPatch: ({ input }) => stixCyberObservableEditContext(context, context.user, id, input),
      contextClean: () => stixCyberObservableCleanContext(context, context.user, id),
      relationAdd: ({ input }) => stixCyberObservableAddRelation(context, context.user, id, input),
      relationsAdd: ({ input }) => stixCyberObservableAddRelations(context, context.user, id, input),
      relationDelete: ({ toId, relationship_type: relationshipType }) => stixCyberObservableDeleteRelation(context, context.user, id, toId, relationshipType),
      exportAsk: (args) => stixCyberObservableExportAsk(context, context.user, assoc('stixCyberObservableId', id, args)),
      exportPush: ({ file }) => stixCyberObservableExportPush(context, context.user, id, file),
      importPush: ({ file }) => stixCoreObjectImportPush(context, context.user, id, file),
      promote: () => promoteObservableToIndicator(context, context.user, id),
    }),
    stixCyberObservableAdd: (_, args, context) => addStixCyberObservable(context, context.user, args),
    stixCyberObservablesExportAsk: (_, args, context) => stixCyberObservablesExportAsk(context, context.user, args),
    stixCyberObservablesExportPush: (_, { file, listFilters }, context) => stixCyberObservablesExportPush(context, context.user, file, listFilters),
    artifactImport: (_, args, context) => artifactImport(context, context.user, args),
  },
  Subscription: {
    stixCyberObservable: {
      resolve: /* istanbul ignore next */ (payload) => payload.instance,
      subscribe: /* istanbul ignore next */ (_, { id }, context) => {
        stixCyberObservableEditContext(context, context.user, id);
        const filtering = withFilter(
          () => pubsub.asyncIterator(BUS_TOPICS[ABSTRACT_STIX_CYBER_OBSERVABLE].EDIT_TOPIC),
          (payload) => {
            if (!payload) return false; // When disconnect, an empty payload is dispatched.
            return payload.user.id !== context.user.id && payload.instance.id === id;
          }
        )(_, { id }, context);
        return withCancel(filtering, () => {
          stixCyberObservableCleanContext(context, context.user, id);
        });
      },
    },
  },
};

export default stixCyberObservableResolvers;
