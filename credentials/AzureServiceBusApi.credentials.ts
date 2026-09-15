import {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AzureServiceBusApi implements ICredentialType {
	name = 'azureServiceBusApi';
	displayName = 'Azure Service Bus API';
	documentationUrl = 'https://docs.microsoft.com/en-us/azure/service-bus-messaging/';

	properties: INodeProperties[] = [
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'options',
			options: [
				{ name: 'Connection String', value: 'connectionString' },
				{ name: 'Azure Managed Identity', value: 'managedIdentity' },
			],
			default: 'connectionString',
		},
		{
			displayName: 'Connection String',
			name: 'connectionString',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=your-key',
			description: 'Azure Service Bus connection string',
			displayOptions: {
				show: {
					authentication: ['connectionString'],
				},
			},
		},
		{
			displayName: 'Fully Qualified Namespace',
			name: 'fullyQualifiedNamespace',
			type: 'string',
			default: '',
			placeholder: 'your-namespace.servicebus.windows.net',
			description: 'The Service Bus namespace host name, used with Managed Identity authentication',
			displayOptions: {
				show: {
					authentication: ['managedIdentity'],
				},
			},
			required: true,
		},
		{
			displayName: 'Managed Identity Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			placeholder: 'Leave empty to use the system-assigned identity',
			description: 'Client ID of a user-assigned managed identity. Leave empty to use the system-assigned identity.',
			displayOptions: {
				show: {
					authentication: ['managedIdentity'],
				},
			},
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {},
	};
}
