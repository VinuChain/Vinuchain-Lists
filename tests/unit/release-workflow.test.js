const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const workflow = fs.readFileSync(
  path.join(__dirname, '../../.github/workflows/release.yml'),
  'utf8',
);

describe('release workflow safety', () => {
  it('checks unreleased changes from the latest published release', () => {
    expect(workflow).to.include('/releases/latest');
    expect(workflow).to.include('git diff --name-only "${RELEASE_TAG}^{commit}" HEAD');
    expect(workflow).to.not.include('git diff --name-only "${BEFORE_SHA}" HEAD');
  });

  it('does not short-circuit a large changed-file list under pipefail', () => {
    expect(workflow).to.include('grep -qE');
    expect(workflow).to.include('<<< "${CHANGED}"');
    expect(workflow).to.not.include('echo "${CHANGED}" | grep -qE');
  });

  it('records an owned or ambiguously successful tag before rebuilding', () => {
    const remoteProof = workflow.indexOf('if [ "${REMOTE_SHA}" = "${COMMIT_SHA}" ]');
    const ownership = workflow.indexOf('echo "reserved=${OWNED}" >> "$GITHUB_OUTPUT"');
    const rebuild = workflow.indexOf('if [ "${CANDIDATE}" != "${TAG}" ]');

    expect(remoteProof).to.be.greaterThan(-1);
    expect(ownership).to.be.greaterThan(remoteProof);
    expect(rebuild).to.be.greaterThan(ownership);
    expect(workflow).to.include('proceeding without claiming cleanup ownership');
  });

  it('uploads every asset while draft and only then publishes', () => {
    const draft = workflow.indexOf('- name: Create owned draft release');
    const upload = workflow.indexOf('- name: Upload assets to owned draft');
    const publish = workflow.indexOf('- name: Publish complete owned draft');

    expect(draft).to.be.greaterThan(-1);
    expect(upload).to.be.greaterThan(draft);
    expect(publish).to.be.greaterThan(upload);
    expect(workflow).to.not.include('softprops/action-gh-release');
    expect(workflow).to.include('--data-binary \'{"draft":false}\'');
    expect(workflow).to.include('is already published; preserving it and tag');
  });

  it('deletes an owned failed tag with an atomic lease', () => {
    expect(workflow).to.include(
      'git push --force-with-lease="refs/tags/${TAG}:${COMMIT_SHA}"',
    );
  });
});
