import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/docker-publish.yml', import.meta.url),
  'utf8'
);
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

function namedWorkflowStep(source, name) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  assert.notEqual(start, -1, `The ${name} workflow step must exist`);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && /^ {0,6}\S/.test(line)) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

test('Docker publish treats the remote build cache as an optional optimization', () => {
  assert.match(
    workflow,
    /cache-to:\s*type=gha,mode=max,ignore-error=true/,
    'A failed GitHub Actions cache export must not fail an otherwise successful image push'
  );
});

test('Docker publishing injects the immutable Git revision into the image', () => {
  const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM ') + 1);
  const revisionArg = runtimeStage.indexOf('\nARG APP_BUILD_REVISION\n');
  const revisionEnv = runtimeStage.indexOf('\nENV APP_BUILD_REVISION=${APP_BUILD_REVISION}\n');
  assert.notEqual(revisionArg, -1, 'The runtime stage must declare APP_BUILD_REVISION');
  assert.ok(revisionEnv > revisionArg, 'ARG APP_BUILD_REVISION must precede the ENV that expands it');
  assert.ok(
    revisionArg > runtimeStage.lastIndexOf('\nRUN ')
      && revisionArg > runtimeStage.lastIndexOf('\nCOPY '),
    'The per-commit revision must not invalidate stable runtime filesystem layers',
  );

  const buildStep = namedWorkflowStep(workflow, 'Build and push');
  assert.match(buildStep, /uses: docker\/build-push-action@/);
  assert.match(
    buildStep,
    /build-args:\s*\|\s*APP_BUILD_REVISION=\$\{\{ github\.sha \}\}/,
  );
});
