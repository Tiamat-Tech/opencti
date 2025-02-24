import { assoc, pipe } from 'ramda';
import { delEditContext, notify, setEditContext } from '../database/redis';
import { createEntity, deleteElementById, storeLoadById, updateAttribute } from '../database/middleware';
import { listEntities } from '../database/middleware-loader';
import { BUS_TOPICS } from '../config/conf';
import { ENTITY_TYPE_LABEL } from '../schema/stixMetaObject';
import { normalizeName } from '../schema/identifier';

export const findById = (context, user, labelId) => {
  return storeLoadById(context, user, labelId, ENTITY_TYPE_LABEL);
};

export const findAll = (context, user, args) => {
  return listEntities(context, user, [ENTITY_TYPE_LABEL], args);
};

export const stringToColour = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let colour = '#';
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-bitwise
    const value = (hash >> (i * 8)) & 0xff;
    colour += `00${value.toString(16)}`.substr(-2);
  }
  return colour;
};

export const addLabel = async (context, user, label) => {
  const finalLabel = pipe(
    assoc('value', normalizeName(label.value).toLowerCase()),
    assoc('color', label.color ? label.color : stringToColour(normalizeName(label.value)))
  )(label);
  const created = await createEntity(context, user, finalLabel, ENTITY_TYPE_LABEL);
  return notify(BUS_TOPICS[ENTITY_TYPE_LABEL].ADDED_TOPIC, created, user);
};

export const labelDelete = (context, user, labelId) => deleteElementById(context, user, labelId, ENTITY_TYPE_LABEL);

export const labelEditField = async (context, user, labelId, input, opts = {}) => {
  const { element } = await updateAttribute(context, user, labelId, ENTITY_TYPE_LABEL, input, opts);
  return notify(BUS_TOPICS[ENTITY_TYPE_LABEL].EDIT_TOPIC, element, user);
};

export const labelCleanContext = async (context, user, labelId) => {
  await delEditContext(user, labelId);
  return storeLoadById(context, user, labelId, ENTITY_TYPE_LABEL).then((label) => notify(BUS_TOPICS[ENTITY_TYPE_LABEL].EDIT_TOPIC, label, user));
};

export const labelEditContext = async (context, user, labelId, input) => {
  await setEditContext(user, labelId, input);
  return storeLoadById(context, user, labelId, ENTITY_TYPE_LABEL).then((label) => notify(BUS_TOPICS[ENTITY_TYPE_LABEL].EDIT_TOPIC, label, user));
};
