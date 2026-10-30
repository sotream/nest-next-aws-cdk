import { RemovalPolicy, aws_ecr as ecr } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** Repository names, shared with the environment stacks that pull from them. */
export const REPOSITORY_NAMES = { api: 'nest-next/api', web: 'nest-next/web' } as const;

/** One repository per application image. Tags are immutable: every image is a pinned commit. */
export class Ecr extends Construct {
  public readonly api: ecr.Repository;
  public readonly web: ecr.Repository;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const repo = (id: string, repositoryName: string) =>
      new ecr.Repository(this, id, {
        repositoryName,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [{ description: 'Keep the last 30 images', maxImageCount: 30 }],
      });
    this.api = repo('Api', REPOSITORY_NAMES.api);
    this.web = repo('Web', REPOSITORY_NAMES.web);
  }
}
