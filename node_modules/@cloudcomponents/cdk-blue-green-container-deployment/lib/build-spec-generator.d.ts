export interface Env {
    readonly variables?: {
        [key: string]: string;
    };
    readonly 'parameter-store'?: {
        [key: string]: string;
    };
}
export interface Phase {
    readonly 'run-as'?: string;
    readonly commands: string[];
    readonly finally?: string[];
}
export interface Artifacts {
    readonly files?: string[];
    readonly name?: string;
    readonly 'base-directory'?: string;
    readonly 'discard-paths'?: 'yes' | 'no';
}
export interface PrimaryArtifacts extends Artifacts {
    readonly 'secondary-artifacts'?: {
        [key: string]: Artifacts;
    };
}
export interface Cache {
    readonly paths: string[];
}
export interface BuildSpecStructure {
    readonly version: '0.2';
    readonly 'run-as'?: string;
    readonly env?: Env;
    readonly phases?: {
        [key: string]: Phase;
    };
    readonly artifacts?: PrimaryArtifacts;
    readonly cache?: Cache;
}
export interface DefaultBuildSpecProps {
    readonly account: string;
    readonly region: string;
}
export declare class BuildSpecGenerator {
    private readonly spec;
    static empty(): BuildSpecGenerator;
    static default(props: DefaultBuildSpecProps): BuildSpecGenerator;
    private constructor();
    render(): BuildSpecStructure;
}
