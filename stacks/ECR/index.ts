import * as cdk from "@aws-cdk/core";
import * as ecr from "@aws-cdk/aws-ecr";
import { App, Stack, StackProps } from "@aws-cdk/core";

export interface ECRStackStackProps extends StackProps {
  readonly repos: string[];
}

export class ECRStack extends cdk.Stack {
  constructor(app: cdk.App, id: string, props: ECRStackStackProps) {
    super(app, id, props);

    const applications = props.repos;
    applications.forEach((app) => {
      const repository = new ecr.Repository(this, `${app}`, {
        repositoryName: app,
      });

      repository.addLifecycleRule({ tagPrefixList: ["Prod"], maxImageCount: 10 });
      repository.addLifecycleRule({ maxImageAge: cdk.Duration.days(30) });
    });
  }
}
