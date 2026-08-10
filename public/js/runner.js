// Collection runner: executes every request in a collection sequentially,
// applying pre-request scripting, variable capture, and test scripting.
import { openModal } from './modal.js';
import { sendRequest, buildProxyPayload } from './send.js';
import { applyCapture, runTests } from './post-response.js';
import { runPreRequestScript, runTestsScript } from './script-sandbox.js';
import { getEnvStore, setEnvStore, getGlobals, setGlobals } from './state.js';

function orderedRequests(collection) {
  const out = [];
  const walk = (parentId) => {
    (collection.folders || [])
      .filter((f) => f.parentId === parentId)
      .forEach((folder) => walk(folder.id));
    collection.requests
      .filter((r) => (r.folderId || null) === parentId)
      .forEach((r) => out.push(r));
  };
  walk(null);
  collection.requests.forEach((r) => {
    if (!out.includes(r)) out.push(r);
  });
  return out;
}

function saveSandboxVars(env, glob) {
  const envStore = getEnvStore();
  const active = envStore.environments.find((e) => e.id === envStore.activeId);
  if (active) {
    active.vars = { ...env };
    setEnvStore(envStore);
  } else {
    setGlobals(glob);
  }
}

export function openRunner(collection, { getVars }) {
  const requests = orderedRequests(collection);

  const container = document.createElement('div');
  container.className = 'runner-container';

  // Summary Dashboard
  const summary = document.createElement('div');
  summary.className = 'runner-summary';

  const statTotal = document.createElement('div');
  statTotal.className = 'runner-stat';
  statTotal.innerHTML = `<span class="runner-stat-val" id="runner-total-val">0</span><span class="runner-stat-label">Total</span>`;

  const statPassed = document.createElement('div');
  statPassed.className = 'runner-stat';
  statPassed.innerHTML = `<span class="runner-stat-val runner-pass" id="runner-passed-val">0</span><span class="runner-stat-label">Passed</span>`;

  const statFailed = document.createElement('div');
  statFailed.className = 'runner-stat';
  statFailed.innerHTML = `<span class="runner-stat-val runner-fail" id="runner-failed-val">0</span><span class="runner-stat-label">Failed</span>`;

  const statTime = document.createElement('div');
  statTime.className = 'runner-stat';
  statTime.innerHTML = `<span class="runner-stat-val" id="runner-time-val">0 ms</span><span class="runner-stat-label">Duration</span>`;

  summary.append(statTotal, statPassed, statFailed, statTime);

  // Progress Bar
  const progressBar = document.createElement('div');
  progressBar.className = 'runner-progress-bar';
  const progressFill = document.createElement('div');
  progressFill.className = 'runner-progress-fill pass';
  progressBar.appendChild(progressFill);

  // List of Requests
  const list = document.createElement('div');
  list.className = 'runner-list';

  container.append(summary, progressBar, list);

  const rows = requests.map((req) => {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'runner-item-wrapper';

    const header = document.createElement('div');
    header.className = 'runner-row-header';

    const method = document.createElement('span');
    method.className = `method-tag method-${req.method}`;
    method.textContent = req.method;

    const name = document.createElement('span');
    name.className = 'runner-name';
    name.textContent = req.name;

    const status = document.createElement('span');
    status.className = 'runner-status';
    status.textContent = 'Pending ⏳';

    header.append(method, name, status);
    itemWrapper.appendChild(header);

    const details = document.createElement('div');
    details.className = 'runner-row-details hidden';
    itemWrapper.appendChild(details);

    header.addEventListener('click', () => {
      details.classList.toggle('hidden');
    });

    list.appendChild(itemWrapper);
    return { req, status, details, header };
  });

  let running = false;

  async function runAll(runBtn) {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';

    // Reset Dashboard
    let passedCount = 0;
    let failedCount = 0;
    let totalDuration = 0;
    let currentIdx = 0;
    
    document.getElementById('runner-total-val').textContent = requests.length;
    document.getElementById('runner-passed-val').textContent = '0';
    document.getElementById('runner-failed-val').textContent = '0';
    document.getElementById('runner-time-val').textContent = '0 ms';
    progressFill.style.width = '0%';
    progressFill.className = 'runner-progress-fill pass';

    rows.forEach(r => {
      r.status.textContent = '⏳';
      r.status.className = 'runner-status';
      r.details.classList.add('hidden');
      r.details.textContent = '';
    });

    for (const { req, status, details, header } of rows) {
      currentIdx++;
      status.textContent = 'Sending… ⏳';
      
      const startTime = Date.now();
      try {
        const activeVars = getVars();
        
        // 1. Run Pre-request Script in sandbox if present
        let finalReq = { ...req };
        if (req.preRequestScript && req.preRequestScript.trim()) {
          const envStore = getEnvStore();
          const activeEnv = envStore.environments.find((e) => e.id === envStore.activeId)?.vars || {};
          const globals = getGlobals();
          
          const scriptResult = runPreRequestScript(req.preRequestScript, {
            environment: activeEnv,
            globals: globals,
            request: buildProxyPayload(req, activeVars)
          });
          
          saveSandboxVars(scriptResult.environment, scriptResult.globals);
          // Apply changes to proxy payload
          finalReq.method = scriptResult.request.method;
          finalReq.url = scriptResult.request.url;
        }

        // 2. Send request
        const result = await sendRequest(finalReq, getVars());
        const duration = Date.now() - startTime;
        totalDuration += duration;

        if (result.error) {
          failedCount++;
          status.textContent = `Error ✗`;
          status.className = 'runner-status runner-fail';
          
          details.innerHTML = `
            <div style="color: var(--red); font-family: monospace;">Request Error: ${result.error}</div>
          `;
          updateDashboardProgress(currentIdx, passedCount, failedCount, totalDuration);
          continue;
        }

        // 3. Apply Capture
        applyCapture(finalReq.capture, result);

        // 4. Run JSON tests
        const pathTests = runTests(finalReq.tests, result);

        // 5. Run JS Test script in sandbox
        let jsTests = [];
        if (finalReq.testsScript && finalReq.testsScript.trim()) {
          const envStore = getEnvStore();
          const activeEnv = envStore.environments.find((e) => e.id === envStore.activeId)?.vars || {};
          const globals = getGlobals();
          
          const scriptResult = runTestsScript(finalReq.testsScript, {
            environment: activeEnv,
            globals: globals,
            request: buildProxyPayload(finalReq, getVars()),
            response: result
          });
          
          saveSandboxVars(scriptResult.environment, scriptResult.globals);
          jsTests = scriptResult.testResults;
        }

        const allTests = [...pathTests, ...jsTests];
        const failedTests = allTests.filter(t => !t.pass).length;
        const totalTests = allTests.length;
        const isRequestPass = result.status < 400 && failedTests === 0;

        if (isRequestPass) {
          passedCount++;
          status.textContent = `${result.status} · ${result.timeMs} ms ✓`;
          status.className = 'runner-status runner-pass';
        } else {
          failedCount++;
          status.textContent = `${result.status} · ${result.timeMs} ms ✗`;
          status.className = 'runner-status runner-fail';
        }

        // Render request details and test list
        details.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: var(--text-dim);">
            <span>URL: <b>${finalReq.url}</b></span>
            <span>Size: <b>${result.size} B</b> · Time: <b>${result.timeMs} ms</b></span>
          </div>
          <div style="font-weight: 600; margin-bottom: 4px; font-size: 11.5px; border-bottom: 1px solid var(--border); padding-bottom: 2px;">Test Results (${allTests.filter(t => t.pass).length}/${totalTests})</div>
          <div class="runner-test-list"></div>
        `;
        
        const testListContainer = details.querySelector('.runner-test-list');
        if (totalTests === 0) {
          testListContainer.innerHTML = `<div style="color: var(--text-dim); font-style: italic;">No tests run.</div>`;
        } else {
          allTests.forEach(test => {
            const tr = document.createElement('div');
            tr.className = `runner-assertion-row ${test.pass ? 'pass' : 'fail'}`;
            tr.innerHTML = `<span>${test.pass ? '✓' : '✗'}</span> <span>${test.label}</span>`;
            if (!test.pass && test.actual) {
              tr.innerHTML += `<span style="font-size: 11px; opacity: 0.7; margin-left: 8px;">(actual: ${test.actual})</span>`;
            }
            testListContainer.appendChild(tr);
          });
        }

      } catch (err) {
        failedCount++;
        status.textContent = `Failed ✗`;
        status.className = 'runner-status runner-fail';
        details.innerHTML = `<div style="color: var(--red); font-family: monospace;">Execution Error: ${err.message}</div>`;
      }
      
      updateDashboardProgress(currentIdx, passedCount, failedCount, totalDuration);
    }

    running = false;
    runBtn.disabled = false;
    runBtn.textContent = 'Run again';
  }

  function updateDashboardProgress(current, passed, failed, duration) {
    document.getElementById('runner-passed-val').textContent = passed;
    document.getElementById('runner-failed-val').textContent = failed;
    document.getElementById('runner-time-val').textContent = `${duration} ms`;

    const percentage = Math.round((current / requests.length) * 100);
    progressFill.style.width = `${percentage}%`;

    if (failed > 0) {
      progressFill.className = 'runner-progress-fill fail';
    }
  }

  openModal(`Run “${collection.name}”`, [container], [
    { label: 'Close', onClick: (close) => close() },
    {
      label: 'Run',
      primary: true,
      onClick: function onRun() {
        const btn = document.querySelector('.modal-actions .btn-primary');
        runAll(btn);
      },
    },
  ]);
}
