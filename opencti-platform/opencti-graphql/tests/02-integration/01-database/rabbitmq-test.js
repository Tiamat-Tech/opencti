import { v4 as uuid } from 'uuid';
import {
  getRabbitMQVersion,
  metrics,
  pushToConnector,
  registerConnectorQueues,
  unregisterConnector,
} from '../../../src/database/rabbitmq';
import { CONNECTOR_INTERNAL_IMPORT_FILE } from '../../../src/schema/general';
import { ADMIN_USER, testContext } from '../../utils/testQuery';

describe('Rabbit basic and utils', () => {
  it('should rabbit in correct version', async () => {
    // Just wait one second to let redis client initialize
    const rabbitVersion = await getRabbitMQVersion(testContext);
    expect(rabbitVersion).toEqual(expect.stringMatching(/^3.11\./g));
  });

  it('should rabbit metrics accurate', async () => {
    // Just wait one second to let redis client initialize
    const data = await metrics(testContext, ADMIN_USER);
    expect(data).not.toBeNull();
    expect(data.overview.management_version).toEqual(expect.stringMatching(/^3.11\./g));
  });
});

describe('Rabbit connector management', () => {
  const connectorId = uuid();
  const connectorName = 'MY STIX IMPORTER';
  const connectorType = CONNECTOR_INTERNAL_IMPORT_FILE;
  const connectorScope = 'application/json';
  it('should register the connector', async () => {
    const config = await registerConnectorQueues(connectorId, connectorName, connectorType, connectorScope);
    expect(config.uri).not.toBeNull();
    expect(config.push).toEqual(`push_${connectorId}`);
    expect(config.push_exchange).toEqual('amqp.worker.exchange');
    expect(config.listen).toEqual(`listen_${connectorId}`);
    expect(config.listen_exchange).toEqual('amqp.connector.exchange');
  });
  it('should connector queues available', async () => {
    const data = await metrics(testContext, ADMIN_USER);
    expect(data).not.toBeNull();
    expect(data.queues.length).toEqual(4);
    const aggregationMap = new Map(data.queues.map((q) => [q.name, q]));
    expect(aggregationMap.get(`listen_${connectorId}`)).not.toBeUndefined();
    expect(aggregationMap.get(`push_${connectorId}`)).not.toBeUndefined();
  });
  it('should push message to connector', async () => {
    const connector = { internal_id: connectorId };
    await pushToConnector(testContext, connector, { id: uuid() });
  });
  it('should delete connector', async () => {
    const unregister = await unregisterConnector(connectorId);
    expect(unregister.listen).not.toBeNull();
    expect(unregister.listen.messageCount).toEqual(1);
    expect(unregister.push).not.toBeNull();
    expect(unregister.push.messageCount).toEqual(0);
    const data = await metrics(testContext, ADMIN_USER);
    const aggregationMap = new Map(data.queues.map((q) => [q.name, q]));
    expect(aggregationMap.get(`listen_${connectorId}`)).toBeUndefined();
    expect(aggregationMap.get(`push_${connectorId}`)).toBeUndefined();
  });
});
