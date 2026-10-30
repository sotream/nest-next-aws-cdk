import { RemovalPolicy, aws_ecr as ecr } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** One repository per application image. Tags are immutable: every image is a pinned commit. */
export class Ecr extends Construct {
  public readonly api: ecr.Repository;
  public readonly web: ecr.Repository;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const repo = (name: string) =>
      new ecr.Repository(this, name, {
        repositoryName: `nest-next/${name.toLowerCase()}`,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [{ description: 'Keep the last 30 images', maxImageCount: 30 }],
      });
    this.api = repo('Api');
    this.web = repo('Web');
  }
}
