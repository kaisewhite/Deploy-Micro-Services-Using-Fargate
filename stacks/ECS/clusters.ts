import * as ecs from "@aws-cdk/aws-ecs";
import * as ec2 from "@aws-cdk/aws-ec2";
import { App, Stack, StackProps } from "@aws-cdk/core";

export interface ECSClusterStackStackProps extends StackProps {
  readonly vpcID: string;
  readonly prefix: string;
  readonly environments: string[];
}

export class ECSClusterStack extends Stack {
  constructor(app: App, id: string, props: ECSClusterStackStackProps) {
    super(app, id, props);

    const envs = props.environments;
    const prefix = props.prefix;
    const ExistingVpc = ec2.Vpc.fromLookup(this, "ImportVPC", { isDefault: false, vpcId: props.vpcID });

    envs.forEach((env) => {
      new ecs.Cluster(this, `${prefix}-${env}`, {
        vpc: ExistingVpc,
        capacityProviders: ["FARGATE", "FARGATE_SPOT"],
        clusterName: `${prefix}-${env}`, //EX: CyberEval-Dev
      });
    });
  }
}
