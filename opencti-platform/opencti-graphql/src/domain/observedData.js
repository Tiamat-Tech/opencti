import * as R from 'ramda';
import {
  createEntity,
  distributionEntities,
  internalLoadById,
  storeLoadById,
  timeSeriesEntities,
} from '../database/middleware';
import { listEntities } from '../database/middleware-loader';
import { BUS_TOPICS } from '../config/conf';
import { notify } from '../database/redis';
import { ENTITY_TYPE_CONTAINER_OBSERVED_DATA, isStixDomainObject } from '../schema/stixDomainObject';
import { RELATION_CREATED_BY, RELATION_OBJECT } from '../schema/stixMetaRelationship';
import { ABSTRACT_STIX_CORE_OBJECT, ABSTRACT_STIX_DOMAIN_OBJECT, buildRefRelationKey } from '../schema/general';
import { elCount } from '../database/engine';
import { READ_INDEX_STIX_DOMAIN_OBJECTS } from '../database/utils';
import { DatabaseError, FunctionalError } from '../config/errors';
import { isStixId } from '../schema/schemaUtils';
import { objects } from './container';
import { observableValue } from '../utils/format';

export const findById = (context, user, observedDataId) => {
  return storeLoadById(context, user, observedDataId, ENTITY_TYPE_CONTAINER_OBSERVED_DATA);
};

export const findAll = async (context, user, args) => {
  return listEntities(context, user, [ENTITY_TYPE_CONTAINER_OBSERVED_DATA], args);
};

export const resolveName = async (context, user, observedData) => {
  const observedDataObjects = await objects(context, user, observedData.id, {
    first: 1,
    types: [ABSTRACT_STIX_CORE_OBJECT],
    connectionFormat: false,
  });
  if (observedDataObjects.length > 0) {
    const firstObject = R.head(observedDataObjects);
    if (isStixDomainObject(firstObject.entity_type)) {
      return firstObject.name;
    }
    return observableValue(firstObject);
  }
  return observedData.last_observed;
};

// All entities
export const observedDataContainsStixObjectOrStixRelationship = async (context, user, observedDataId, thingId) => {
  const resolvedThingId = isStixId(thingId) ? (await internalLoadById(context, user, thingId)).id : thingId;
  const args = {
    filters: [
      { key: 'internal_id', values: [observedDataId] },
      { key: buildRefRelationKey(RELATION_OBJECT), values: [resolvedThingId] },
    ],
  };
  const observedDataFound = await findAll(context, user, args);
  return observedDataFound.edges.length > 0;
};

// region series
export const observedDatasTimeSeries = (context, user, args) => {
  return timeSeriesEntities(context, user, ENTITY_TYPE_CONTAINER_OBSERVED_DATA, [], args);
};

export const observedDatasNumber = (context, user, args) => ({
  count: elCount(user, READ_INDEX_STIX_DOMAIN_OBJECTS, R.assoc('types', [ENTITY_TYPE_CONTAINER_OBSERVED_DATA], args)),
  total: elCount(
    user,
    READ_INDEX_STIX_DOMAIN_OBJECTS,
    R.pipe(R.assoc('types', [ENTITY_TYPE_CONTAINER_OBSERVED_DATA]), R.dissoc('endDate')(args))
  ),
});

export const observedDatasTimeSeriesByEntity = (context, user, args) => {
  const filters = [{ isRelation: true, type: RELATION_OBJECT, value: args.objectId }];
  return timeSeriesEntities(context, user, ENTITY_TYPE_CONTAINER_OBSERVED_DATA, filters, args);
};

export const observedDatasTimeSeriesByAuthor = async (context, user, args) => {
  const { authorId } = args;
  const filters = [
    {
      isRelation: true,
      from: `${RELATION_CREATED_BY}_from`,
      to: `${RELATION_CREATED_BY}_to`,
      type: RELATION_CREATED_BY,
      value: authorId,
    },
  ];
  return timeSeriesEntities(context, user, ENTITY_TYPE_CONTAINER_OBSERVED_DATA, filters, args);
};

export const observedDatasNumberByEntity = (context, user, args) => ({
  count: elCount(
    user,
    READ_INDEX_STIX_DOMAIN_OBJECTS,
    R.pipe(
      R.assoc('isMetaRelationship', true),
      R.assoc('types', [ENTITY_TYPE_CONTAINER_OBSERVED_DATA]),
      R.assoc('relationshipType', RELATION_OBJECT),
      R.assoc('fromId', args.objectId)
    )(args)
  ),
  total: elCount(
    user,
    READ_INDEX_STIX_DOMAIN_OBJECTS,
    R.pipe(
      R.assoc('isMetaRelationship', true),
      R.assoc('types', [ENTITY_TYPE_CONTAINER_OBSERVED_DATA]),
      R.assoc('relationshipType', RELATION_OBJECT),
      R.assoc('fromId', args.objectId),
      R.dissoc('endDate')
    )(args)
  ),
});

export const observedDatasDistributionByEntity = async (context, user, args) => {
  const { objectId } = args;
  const filters = [{ isRelation: true, type: RELATION_OBJECT, value: objectId }];
  return distributionEntities(context, user, ENTITY_TYPE_CONTAINER_OBSERVED_DATA, filters, args);
};
// endregion

// region mutations
export const addObservedData = async (context, user, observedData) => {
  if (observedData.objects.length === 0) {
    throw FunctionalError('Observed data must contain at least 1 object');
  }
  if (observedData.first_observed > observedData.last_observed) {
    throw DatabaseError('You cant create an observed data with last_observed less than first_observed', {
      input: observedData,
    });
  }
  const observedDataResult = await createEntity(context, user, observedData, ENTITY_TYPE_CONTAINER_OBSERVED_DATA);
  return notify(BUS_TOPICS[ABSTRACT_STIX_DOMAIN_OBJECT].ADDED_TOPIC, observedDataResult, user);
};
// endregion
