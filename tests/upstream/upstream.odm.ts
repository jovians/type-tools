import { dataclass, ModelDef, semver, Upstream } from "../../src";

@dataclass({ classVersion: semver('0.0.1'), })
export class TestClass {
  static index: typeof TestClassUpstream.index;
  prop1: string = null;
  second: string = 'test';

  constructor(init?: Partial<TestClass>) {
    ModelDef(this, TestClass, init, {});
  }
}
const TestClassUpstream = {
  index: Upstream.index(TestClass, addIndex => ({
    primary: addIndex({ unique: true }, {
      prop1: true,
    }),
    secondary: addIndex({}, {
      second: true,
    }),
  })),
};
