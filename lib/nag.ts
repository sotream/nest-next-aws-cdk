import { App, Validations, aws_ecs as ecs } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

/** Runs the AwsSolutions rule pack on everything synthesised; a finding fails the synth. */
export function enableNag(app: App): void {
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
}

/** Acknowledgements that hold for every task definition of this app. */
export function acknowledgeTaskDefinition(taskDefinition: ecs.TaskDefinition): void {
  Validations.of(taskDefinition).acknowledge({
    id: 'AwsSolutions-ECS2',
    reason:
      'The plain environment variables are non-secret configuration (APP_ENV, PORT, origin, log level). Every secret is injected from Secrets Manager.',
  });
  Validations.of(taskDefinition.obtainExecutionRole()).acknowledge({
    id: 'AwsSolutions-IAM5[Resource::*]',
    reason:
      'ecr:GetAuthorizationToken does not support resource-level permissions. The image pull and log permissions are scoped to the repository and the log group.',
  });
}
