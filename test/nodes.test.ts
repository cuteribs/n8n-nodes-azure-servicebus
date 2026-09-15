import { AzureServiceBus } from '../nodes/AzureServiceBus/AzureServiceBus.node';
import { AzureServiceBusTrigger } from '../nodes/AzureServiceBusTrigger/AzureServiceBusTrigger.node';
import { AzureServiceBusApi } from '../credentials/AzureServiceBusApi.credentials';
import { createServiceBusClient } from '../nodes/GenericFunctions';

describe('AzureServiceBus Node', () => {
	let node: AzureServiceBus;

	beforeEach(() => {
		node = new AzureServiceBus();
	});

	describe('Node Description', () => {
		it('should have correct display name', () => {
			expect(node.description.displayName).toBe('Azure Service Bus');
		});

		it('should have correct node name', () => {
			expect(node.description.name).toBe('azureServiceBus');
		});

		it('should have correct version', () => {
			expect(node.description.version).toBe(1);
		});

		it('should require azureServiceBusApi credentials', () => {
			expect(node.description.credentials).toBeDefined();
			expect(node.description.credentials).toHaveLength(1);
			expect(node.description.credentials![0].name).toBe('azureServiceBusApi');
			expect(node.description.credentials![0].required).toBe(true);
		});

		it('should have main input and output', () => {
			expect(node.description.inputs).toContain('main');
			expect(node.description.outputs).toContain('main');
		});

		it('should support queue and topic resources', () => {
			const resourceProperty = node.description.properties.find(p => p.name === 'resource');
			expect(resourceProperty).toBeDefined();
			expect(resourceProperty?.options).toHaveLength(2);
			const optionValues = (resourceProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('queue');
			expect(optionValues).toContain('topic');
		});

		it('should support sdk and http protocols', () => {
			const protocolProperty = node.description.properties.find(p => p.name === 'protocol');
			expect(protocolProperty).toBeDefined();
			expect(protocolProperty?.options).toHaveLength(2);
			const optionValues = (protocolProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('sdk');
			expect(optionValues).toContain('http');
		});

		it('should have session mode options for receive', () => {
			const sessionModeProperty = node.description.properties.find(p => p.name === 'sessionMode');
			expect(sessionModeProperty).toBeDefined();
			const optionValues = (sessionModeProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('none');
			expect(optionValues).toContain('specific');
			expect(optionValues).toContain('next');
		});
	});

	describe('Queue Operations', () => {
		it('should have sendMessage operation for queues', () => {
			const queueOperationProperty = node.description.properties.find(
				p => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('queue')
			);
			expect(queueOperationProperty).toBeDefined();
			const optionValues = (queueOperationProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('sendMessage');
		});

		it('should have receiveMessages operation for queues', () => {
			const queueOperationProperty = node.description.properties.find(
				p => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('queue')
			);
			expect(queueOperationProperty).toBeDefined();
			const optionValues = (queueOperationProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('receiveMessages');
		});
	});

	describe('Topic Operations', () => {
		it('should have sendMessage operation for topics', () => {
			const topicOperationProperty = node.description.properties.find(
				p => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('topic')
			);
			expect(topicOperationProperty).toBeDefined();
			const optionValues = (topicOperationProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('sendMessage');
		});
	});

	describe('Execute Method', () => {
		it('should have execute method', () => {
			expect(node.execute).toBeDefined();
			expect(typeof node.execute).toBe('function');
		});
	});
});

describe('AzureServiceBusTrigger Node', () => {
	let trigger: AzureServiceBusTrigger;

	beforeEach(() => {
		trigger = new AzureServiceBusTrigger();
	});

	describe('Node Description', () => {
		it('should have correct display name', () => {
			expect(trigger.description.displayName).toBe('Azure Service Bus Trigger');
		});

		it('should have correct node name', () => {
			expect(trigger.description.name).toBe('azureServiceBusTrigger');
		});

		it('should be in trigger group', () => {
			expect(trigger.description.group).toContain('trigger');
		});

		it('should have no inputs (trigger)', () => {
			expect(trigger.description.inputs).toHaveLength(0);
		});

		it('should have main output', () => {
			expect(trigger.description.outputs).toContain('main');
		});

		it('should require azureServiceBusApi credentials', () => {
			expect(trigger.description.credentials).toBeDefined();
			expect(trigger.description.credentials).toHaveLength(1);
			expect(trigger.description.credentials![0].name).toBe('azureServiceBusApi');
		});

		it('should support queue and subscription resources', () => {
			const resourceProperty = trigger.description.properties.find(p => p.name === 'resource');
			expect(resourceProperty).toBeDefined();
			const optionValues = (resourceProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('queue');
			expect(optionValues).toContain('subscription');
		});

		it('should have session mode options', () => {
			const sessionModeProperty = trigger.description.properties.find(p => p.name === 'sessionMode');
			expect(sessionModeProperty).toBeDefined();
			const optionValues = (sessionModeProperty?.options as Array<{ value: string }>).map(o => o.value);
			expect(optionValues).toContain('none');
			expect(optionValues).toContain('any');
			expect(optionValues).toContain('specific');
		});

		it('should have autoComplete option', () => {
			const autoCompleteProperty = trigger.description.properties.find(p => p.name === 'autoComplete');
			expect(autoCompleteProperty).toBeDefined();
			expect(autoCompleteProperty?.type).toBe('boolean');
			expect(autoCompleteProperty?.default).toBe(true);
		});

		it('should have maxConcurrentCalls option', () => {
			const maxConcurrentProperty = trigger.description.properties.find(p => p.name === 'maxConcurrentCalls');
			expect(maxConcurrentProperty).toBeDefined();
			expect(maxConcurrentProperty?.type).toBe('number');
			expect(maxConcurrentProperty?.default).toBe(1);
		});
	});

	describe('Trigger Method', () => {
		it('should have trigger method', () => {
			expect(trigger.trigger).toBeDefined();
			expect(typeof trigger.trigger).toBe('function');
		});
	});
});

describe('AzureServiceBusApi Credentials', () => {
	let credentials: AzureServiceBusApi;

	beforeEach(() => {
		credentials = new AzureServiceBusApi();
	});

	describe('Credentials Definition', () => {
		it('should have correct name', () => {
			expect(credentials.name).toBe('azureServiceBusApi');
		});

		it('should have correct display name', () => {
			expect(credentials.displayName).toBe('Azure Service Bus API');
		});

		it('should have connectionString property', () => {
			const connStringProp = credentials.properties.find(p => p.name === 'connectionString');
			expect(connStringProp).toBeDefined();
			expect(connStringProp?.type).toBe('string');
		});

		it('should have password type for connectionString', () => {
			const connStringProp = credentials.properties.find(p => p.name === 'connectionString');
			expect(connStringProp?.typeOptions?.password).toBe(true);
		});

		it('should have generic authentication type', () => {
			expect(credentials.authenticate.type).toBe('generic');
		});

		it('should have managedIdentity as an authentication option', () => {
			const authProp = credentials.properties.find(p => p.name === 'authentication');
			expect(authProp?.options).toEqual(
				expect.arrayContaining([expect.objectContaining({ value: 'managedIdentity' })]),
			);
		});

		it('should have fullyQualifiedNamespace property for managed identity', () => {
			const nsProp = credentials.properties.find(p => p.name === 'fullyQualifiedNamespace');
			expect(nsProp).toBeDefined();
			expect(nsProp?.displayOptions?.show?.authentication).toEqual(['managedIdentity']);
		});
	});
});

describe('createServiceBusClient', () => {
	it('throws when connection string authentication has no connection string', () => {
		expect(() => createServiceBusClient({ authentication: 'connectionString' })).toThrow(
			'Azure Service Bus connection string is required',
		);
	});

	it('throws when managed identity authentication has no namespace', () => {
		expect(() => createServiceBusClient({ authentication: 'managedIdentity' })).toThrow(
			'Fully Qualified Namespace is required for Managed Identity authentication',
		);
	});

	it('builds a client for managed identity with a fully qualified namespace', () => {
		const client = createServiceBusClient({
			authentication: 'managedIdentity',
			fullyQualifiedNamespace: 'my-namespace.servicebus.windows.net',
		});
		expect(client.fullyQualifiedNamespace).toBe('my-namespace.servicebus.windows.net');
	});
});
