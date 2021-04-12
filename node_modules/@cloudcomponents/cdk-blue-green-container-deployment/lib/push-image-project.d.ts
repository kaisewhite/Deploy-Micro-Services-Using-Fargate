import { Cache, PipelineProject, BuildSpec, ComputeType, BuildEnvironmentVariable } from '@aws-cdk/aws-codebuild';
import { IRepository } from '@aws-cdk/aws-ecr';
import { Construct } from '@aws-cdk/core';
import { IDummyTaskDefinition } from './dummy-task-definition';
export interface PushImageProjectProps {
    readonly imageRepository: IRepository;
    readonly taskDefinition: IDummyTaskDefinition;
    readonly environmentVariables?: Record<string, BuildEnvironmentVariable>;
    readonly projectName?: string;
    readonly cache?: Cache;
    readonly buildSpec?: BuildSpec;
    readonly computeType?: ComputeType;
}
export declare class PushImageProject extends PipelineProject {
    constructor(scope: Construct, id: string, props: PushImageProjectProps);
}
