// JavaScript execution sandbox for Pre-request and Tests scripts.

function createPmSandbox(context) {
  const env = { ...context.environment };
  const glob = { ...context.globals };
  const req = { ...context.request };
  const resp = context.response ? {
    status: context.response.status,
    headers: context.response.headers || {},
    body: context.response.body || '',
    json: () => {
      try {
        return JSON.parse(context.response.body);
      } catch {
        return null;
      }
    },
    text: () => context.response.body || ''
  } : null;

  const pm = {
    environment: {
      get: (key) => env[key],
      set: (key, val) => { env[key] = String(val); },
      unset: (key) => { delete env[key]; },
      _getAll: () => env
    },
    globals: {
      get: (key) => glob[key],
      set: (key, val) => { glob[key] = String(val); },
      unset: (key) => { delete glob[key]; },
      _getAll: () => glob
    },
    variables: {
      get: (key) => {
        if (key in env) return env[key];
        if (key in glob) return glob[key];
        return undefined;
      }
    },
    request: req,
    response: resp,
    expect: (actual) => {
      const assertions = {
        toBe: (expected) => {
          if (actual !== expected) throw new Error(`expected ${actual} to be ${expected}`);
        },
        toEqual: (expected) => {
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
          }
        },
        toContain: (sub) => {
          if (typeof actual?.includes === 'function') {
            if (!actual.includes(sub)) throw new Error(`expected ${actual} to contain ${sub}`);
          } else {
            throw new Error(`expected ${actual} to contain ${sub}`);
          }
        },
        toBeTruthy: () => {
          if (!actual) throw new Error(`expected ${actual} to be truthy`);
        },
        toBeFalsy: () => {
          if (actual) throw new Error(`expected ${actual} to be falsy`);
        },
        toBeDefined: () => {
          if (actual === undefined) throw new Error(`expected value to be defined`);
        },
        toBeUndefined: () => {
          if (actual !== undefined) throw new Error(`expected value to be undefined`);
        }
      };
      return assertions;
    }
  };

  if (resp) {
    pm.response.to = {
      have: {
        status: (code) => {
          if (resp.status !== code) {
            throw new Error(`expected response status ${resp.status} to be ${code}`);
          }
        }
      }
    };
  }

  return pm;
}

export function runPreRequestScript(scriptCode, context) {
  if (!scriptCode || !scriptCode.trim()) return context;
  const pm = createPmSandbox(context);

  try {
    const fn = new Function('pm', scriptCode);
    fn(pm);
  } catch (err) {
    console.error('Error running pre-request script:', err);
    throw new Error(`Pre-request script error: ${err.message}`);
  }

  return {
    environment: pm.environment._getAll(),
    globals: pm.globals._getAll(),
    request: pm.request
  };
}

export function runTestsScript(scriptCode, context) {
  const testResults = [];
  if (!scriptCode || !scriptCode.trim()) return { environment: context.environment, globals: context.globals, testResults };
  
  const pm = createPmSandbox(context);

  pm.test = (name, testFn) => {
    try {
      testFn();
      testResults.push({ label: name, pass: true });
    } catch (err) {
      testResults.push({ label: name, pass: false, actual: err.message });
    }
  };

  try {
    const fn = new Function('pm', scriptCode);
    fn(pm);
  } catch (err) {
    console.error('Error running tests script:', err);
    testResults.push({ label: `Script Execution Error`, pass: false, actual: err.message });
  }

  return {
    environment: pm.environment._getAll(),
    globals: pm.globals._getAll(),
    testResults
  };
}
