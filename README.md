# TypeTools

TypeTools is a Typescript library for providing extensible tooling runtime validations and type helpers.

## General Structure

TypeTools library is designed to help programmers add useful runtime features for class instances and data models.

```typescript
import { defineOn } from '@jovian/type-tools';
class TargetClass {  
  constructor(init?: Partial<TargetClass>) {
    defineOn( this, TargetClass, lib => {
      lib.extension1.featureA( /* define */ )
      ...
      lib.extension2.featureX( /* define */ ) 
}
```

### Feature Extensions

- **`Validatable`** (Runtime data model validation)
- **`Ephemerals`** (Non-serializable properties)
- **`Derivables`** (Derived properties)

#### Base Classes

- **`TypeToolsBase`** (Base interface for all extensions)
- **`DataImportable`** (Instance initialization from object initializers)
- **`PropertiesController`** (Controller class for getters & setters)

#### Util Classes

- **`ClassLineage`** (Inheritance utils)

&nbsp;

## `Validatable` - Runtime Data Model Validation

While using interfaces as data model definitions type-guides programmers during development, it does not support robust runtime enforcement on instantiated models. Ideally, data validation should accompany the data definition itself; however, native data modeling with Typescript interfaces often forces programmers to scatter validation logic elsewhere in the codebase.

An `initializable class` as the data model definition instead of using `interface` can assist greatly in pinpointing the source of bad data on runtime as well as keeping validation definitions nicely in the class definition itself. (** The only cavest is the performance overhead, which is relatively negligible unless you are dealing with millions of objects. See *Performance Characteristics*  section for more details).

```typescript
import { Validatable, defineOn } from '@jovian/type-tools';
class MyModel {
  strVal = 'test';
  numVal = 5;
  dateVal = null;
  constructor(init?: Partial<MyModel>) {
    defineOn( this, MyModel, lib => {
      lib.validatable.enforce( this, { init }, {
          strVal (value, e) { // throw on bad assignment
            if ( typeof value !== 'string'  ||  ! value.startsWith('test') ) {
              return e.throw(`${e.path} must be a truthy string starting with 'test'`); }},
          numVal (value, e) { // don't throw; just ignore bad assignments
            if ( typeof v !== 'number' ) {
              return e.cancel(); }}, // equivalently: return false;
          dateVal (value, e) { // hijack & transform assigment value
            if ( value === 'transformMe' ) {
              return e.transformValue(new Date()); }},
        });
    });
  }
}

// Generic object testing against a given type (true/false)
const result = Validatable.test({ strVal: 'bad' }, MyModel); // false
// Runtime Instantiation Guard
const inst1 = new MyModel(); // valid; default prop1='test' and prop2=5 are valid.
const inst2 = new MyModel({ strVal: 'test2' }) // valid; starts with 'test'
const inst3 = new MyModel({ strVal: 'yolo', numVal: 100 }); // throws; 'yolo' does not start with 'test'
// Runtime Property Assignment Guard
inst1.strVal = 'a'; // throws; and assignment cancels
inst1.numVal = 'string'; // canceled ("ignored"); will remain value 5
inst1.dateVal = 'transformMe';  // transformed; inst1.dateVal will be new Date() instance.
// External Data Casting
const inst1_1 = Validatable.cast(MyModel, { numVal: 10, dateVal: null }); // valid; new MyModel instance { strVal: 'test', numVal: 10, dateVal: null }
const inst1_2 = Validatable.cast(MyModel, { strVal: 'bad' }); // throws
const inst1_3 = Validatable.cast(MyModel, { strVal: 'bad' }, false); // returns null; throwError=false
```

## `Ephemerals` - Serialization Control

`Ephemerals` extension will modify `toJSON` function of the class to make sure ephemeral properties are not serialized by `JSON.stringify`. (Performance cost: negligible.)

```typescript
class EphemTest {
  keptProp = 'value';
  ignoredProp1 = 'test5'; /* EPHEM */
  ignoredProp2 = 5; /* EPHEM */
  constructor(init?: Partial<EphemTest>) {
    defineOn(this, EphemTest, lib => {
      lib.ephemerals.of(this, {
        ignoredProp1: true,
        ignoredProp2: true,
        ...
  }
}
console.log( JSON.stringify(new EphemTest()) ); // {"keptProp":"value"}
```

## `Derivables` - Derived Properties

`Derivables` extension will listen to source properties changes and update the derived property's value. Usually, derived properties are also non-serializable (since it can be derived from data), therefore you can apply `Ephemerals` on it.

```typescript
class DerivedTestClass {
  strVal = 'string';
  numVal = 5;
  derivedProp: string; /* DERIVED */
  derivedProp2: string; /* DERIVED EPHEM */
  constructor(init?: Partial<DerivedTestClass>) {
    defineOn(this, DerivedTestClass, lib => {
      lib.derivables.of(this, { /* options */ }, {
        derivedProp: (strVal, numVal) => strVal + numVal, // short format
        derivedProp2: { // long format, functionally the same as above (a little fatster in terms of perf)
          from: { strVal:1, numVal:1 },
          derive() { return this.strVal + this.numVal; }
        }
        ...
      lib.ephemerals.of(this, { derivedProp2: true, ...
  }
}

const d = new DerivedTestClass({ strVal: 'joined', numVal: 5 }));
console.log( d.derivedProp ); // 'joined5'
d.strVal = 'joined2_'; // updated source
d.numVal = 10;
console.log( d.derivedProp ); // 'joinedUpdated_10' automatically updated
console.log( JSON.stringify(d) ); // derivedProp2 not saved: {"strVal":"joined2_","numVal":10,"derivedProp":"joined2_10"}
```

## `PropertiesController` - Getters/Setters

Most extensions are built on the base class `PropertiesController` which does a lot more general handling of getters, setters, and onvaluechage events.

```typescript
import { defineOn } from '@jovian/type-tools';
class MyClass {
  myProp1 = 'firstValue';
  myProp2 = 300;
  constructor(init?: Partial<MyClass>) {
    defineOn(this, MyClass, lib => {
      const manageOptions = {}; // options like 'prepend', 'alwaysFront', 'alwaysBack', 'order'
      lib.propertiesController.manage(this, manageOptions, {
        myProp1: {
          set(value, e) { console.log(`setter: ${e.path} being set '${value}'`); },
          get(value, e) { console.log(`getter: ${e.path} being accessed`); },
          change(oldValue, newValue, e) { console.log(`onchange: ${e.path} changed from '${oldValue}' to '${newValue}'`); },
        }
      });
      // manage function is additive in terms of handlers
      lib.propertiesController.manage(this, manageOptions, {
        myProp1: {
          set(value, e) { console.log(`setter 2`); },
          get(value, e) { console.log(`getter 2`); },
          change(oldValue, newValue, e) { console.log(`onchange 2`); },
        }
      });
  }
}

const a = new MyClass();
a.myProp1 = a.myProp1 + '2';
// getter: MyClass.myProp1 being accessed
// getter 2
// setter: MyClass.myProp1 being set 'firstValue2'
// setter 2
// onchange: MyClass.myProp1 changed from 'firstValue' to 'firstValue2'
// onchange 2
```

## `ClassLineage` - Inheritance Util

`ClassLineage.of` fetches top-down inheritance chain of given class instance or class itself.

```typescript
import { ClassLineage } from '@jovian/type-tools';

class A {}
class B extends A {}
...
class Z extends Y {}

const a = new A();
const b = new B();

// Class itself
ClassLineage.of(A); // [A]
ClassLineage.of(B); // [A, B]
// Or its class instances
ClassLineage.of(a); // [A]
ClassLineage.of(b); // [A, B]

ClassLineage.namesOf(B); // ['A', 'B']
ClassLineage.namesOf(b); // ['A', 'B']

// Parent of
ClassLineage.parentOf(B); // A
ClassLineage.parentNameOf(B); // 'A'
ClassLineage.parentOf(A); // null; A doesn't extend from anything
ClassLineage.parentNameOf(A); // null

// Bottom-up order
ClassLineage.of(Z, false);  // [Z, Y, ..., A]
ClassLineage.namesOf(Z, false);  // ['Z', 'Y', ..., 'A']

// Ancestry
ClassLineage.lastCommonAncestor(A, B); // A
ClassLineage.commonAncestorInfo(A, B); // { commonAncestors: [ A ], lastCommonAncestor: A, senior: A, junior: B, distance: 1, travel: 0, levelCompare: 1, levelDifference: 1 }
class Unrelated {}
ClassLineage.commonAncestorInfo(A, Unrelated); // { commonAncestors: [], lastCommonAncestor: null, senior: null, junior: null, distance: Infinity, travel: Infinity, levelCompare: NaN, levelDifference: NaN }
class B2 extends A {}
ClassLineage.areRelated(B, B2); // true; common parent A
ClassLineage.areRelated(B, Unrelated); // false; no common ancestor
```

Performance: all `ClassLineage` methods are about **10M/s**; results are auto-cached since types don't generally change during runtime. To turn it off, set `ClassLineage.noCache` to true.

## Advanced Topics

### `Validatable` Inheritance Control

#### Building onto Parent Class Validations

```typescript
class MyModel2 extends MyModel {
  constructor(init?: Partial<MyModel2>) {
    super(); // inherits all definitions from parent
    defineOn( this, MyModel2, lib => {
      lib.validatable.enforce( this, { init }, {
          strVal (value, e) { // add additional validation on strVal
            if ( !value.endsWith('_ending') ) {
              return e.throw(`${e.path} must end with '_ending'`);
          ...
  }
}

const a = new MyModel(); // valid; MyModel only requires startsWith('test')
const b = new MyModel2({ strVal: 'test_ending' }); // valid, starts with 'test' and ends with '_ending'
const a = new MyModel2(); // throws; NOTE: default initializer strVal 'test' defined in MyModel fails at the new constraint endsWith('_ending')
```

#### Selectively Overriding Parent Class Validations

1) `beforeSuper` to execute before parent constructor to register a preceding handler
2) and control flow the definitions by:
   - `e.stopPropagation()` to stop the event chain early OR
   - `e.ignoreDefinitionsFrom(...Classes)` to selectively ignore amongst stacked handlers

```typescript
import { defineOn, beforeSuper, beforeDefinitionOf, superArgs } from '@jovian/type-tools';
// Inheritance flow:
//      MyModel -> MyModel2 -> MyOverridingModel
class MyOverridingModel extends MyModel2 {
  newProp: string = '';
  constructor(init?: Partial<TestClassModified2>) {
    super(...beforeSuper(() => {
      beforeDefinitionOf(MyModel, instance => {
        defineOn(instance, MyOverridingModel, lib => {
          lib.validatable.enforce(instance, { /* no init */ }, {
            strVal(value, e) {
              e.ignoreDefinitionsFrom(MyModel);
                // moving forward, ignore strVal handler from MyModel,
                // but still use validations defined in MyModel2
              // OR
              e.stopPropagation(); // this makes this handler the only active validation for strVal
              /* do validations here; will execute before MyModel's handlers */
              // ...
      beforeDefinitionOf(MyModel2, instance => {
        /* Some logic to override MyModel2 */
      });
    }, superArgs( /* no init */ ) ));
    // To add validations for new members,
    // and finish with initializing from 'init'
    defineOn(this, MyOverridingModel, lib => {
      lib.validatable.enforce(this, { init }, {
        strVal (value, e) { /* reachable if stopPropagation hasn't been called */ }
        newProp (value, e) { /* validate newly added class member */ }
      });
    });
  }
}

const a = new MyOverridingModel({ strVal: '_ending' });
// valid; no longer has to start with 'test' (MyModel validation ignored)
// but still has to end with _ending (defined in MyModel2)
```

### `Validatable` Performance Characteristics

Baseline (on ~2.5 Ghz core, slower as more complex validations added):

- Good data:
  - Instantiation: **100k/s** (e.g. `let a = new MyModel(data);`)
  - Property set: **2.5M/s** (e.g. `a.prop = b`)
- Bad data:
  - If using try/catch block (expensive):
    - Instantiation: **50k/s**, Property set: **250k/s**
  - Using `Validatable.errorsOf` to detect fault (See next section)
    - Instantiation: **100k/s**, Property set: **1.5M/s**
- `TypeTools.test(obj, MyModel)` **1 M/s** (good data), **500k/s** (bad data)

If you've called `TypeTools.config.disableExtensions(Validatable)` and are manually validating, instantiation and property set are both within around **5M ~ 50M/s**

#### Performance Optimization

The slowest part of validatable class is the **instantiation** (due to registration overhead of TypeTools extensions) and **try/catch block** (creating new error and throwing is pretty expensive because of stack tracing overhead.)

Performance can be greatly helped by:

1) If validity checking is all you need, use `Validatable.test(obj, MyModel)`
2) Running with `TypeTools.config.disableThrow()` and manually checking

```typescript
import { defineOn, TypeTools, Validatable, ... } from '@jovian/type-tools';

const obj = { strVal: 'test', numVal: 100 };

// 1) If validity checking is all you need,
let valid: boolean;
valid = Validatable.test(obj, MyModel); // relatively inexpensive.
valid = TypeTools.test(obj, MyModel); // TypeTools.test is an alias of Validatable.test

// 2) Opt in for manually checking errors instead of throwing.
TypeTools.config.disableThrow();
const inst = new MyModel(obj); // would throw normally but doesn't throw.
inst.strVal = 'invalid'; // would throw normally but doesn't throw.
inst.numVal = 'not a number'; // cancels assignment.

valid = Validatable.resultOf(a); // false; inst has 2 errors and 1 cancel.

const instErrors = Validatable.errorsOf(a);
if (instErrors.length > 0) { /* some properties called e.throw */
  for (const tracer of instErrors) {
    console.log(`${tracer.e.path} has errored with ${tracer.trace.message}, stack: ${tracer.trace.stack}`);
    // [0] = strVal ERROR at `new MyModel(obj)` where strVal = 'test' is executed.
    // [1] = strVal ERROR at `inst.strVal = 'invalid';`
  }
}
const instCancels = Validatable.cancelsOf(a);
if (aCancels.length > 0) { /* some properties called e.cancel */
  for (const tracer of instCancels) {
    console.log(`${tracer.e.path} has errored with ${tracer.trace.message}, stack: ${tracer.trace.stack}`);
    // [0] = numVal assignment CANCEL on instantiation at `inst.numVal = 'not a number'`
  }
}
```

## License

Copyright (c) 2020 Jovian (jovian.technologies@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
