import { ICredentialDataDecryptedObject } from 'n8n-workflow';
import { ServiceBusClient, ServiceBusClientOptions } from '@azure/service-bus';
import { ManagedIdentityCredential } from '@azure/identity';

/**
 * Builds a ServiceBusClient from AzureServiceBusApi credentials, supporting both
 * connection string and Azure Managed Identity authentication. Shared by the
 * regular node and the trigger node so the auth logic only lives in one place.
 */
export function createServiceBusClient(
	credentials: ICredentialDataDecryptedObject,
	options: ServiceBusClientOptions = {},
): ServiceBusClient {
	const authentication = (credentials.authentication as string) || 'connectionString';

	let opts = options;
	try {
		const WebSocket = require('ws');
		opts = { ...options, webSocketOptions: { webSocket: WebSocket } };
	} catch {
		// ponytail: ws is an optional transport fallback, default transport is used when unavailable
	}

	if (authentication === 'managedIdentity') {
		const fullyQualifiedNamespace = credentials.fullyQualifiedNamespace as string;
		if (!fullyQualifiedNamespace) {
			throw new Error('Fully Qualified Namespace is required for Managed Identity authentication');
		}
		const clientId = credentials.clientId as string;
		const credential = clientId ? new ManagedIdentityCredential(clientId) : new ManagedIdentityCredential();
		return new ServiceBusClient(fullyQualifiedNamespace, credential, opts);
	}

	const connectionString = credentials.connectionString as string;
	if (!connectionString) {
		throw new Error('Azure Service Bus connection string is required');
	}
	if (connectionString.includes('__n8n_BLANK_VALUE_')) {
		throw new Error('Connection string contains blank values. Please re-enter your credentials.');
	}
	return new ServiceBusClient(connectionString, opts);
}
