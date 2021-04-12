#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { CyberevalInfraCdkStack } from "../lib/cybereval-infra-cdk-stack";
import * as dotenv from "dotenv";
dotenv.config();

const app = new cdk.App();
new CyberevalInfraCdkStack(app, `${process.env.CDK_STACK_NAME}`, {
  env: { account: `${process.env.CDK_DEFAULT_ACCOUNT}`, region: `${process.env.CDK_DEFAULT_REGION}` },
  description: `${process.env.DESCRIPTION}`,
});

app.synth();
