const { expect } = require('chai');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workflow = fs.readFileSync(
  path.join(__dirname, '../../.github/workflows/release.yml'),
  'utf8',
);

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

describe('release workflow safety', () => {
  it('checks unreleased changes from the latest published release', () => {
    expect(workflow).to.include('/releases/latest');
    expect(workflow).to.include('Registry commit: ');
    expect(workflow).to.include(
      'capture("(?m)^Registry commit: (?<sha>[0-9a-fA-F]{40})$")',
    );
    expect(workflow).to.include('.target_commitish // empty');
    expect(workflow).to.include(
      'git diff --name-only "${RELEASE_COMMIT}^{commit}" HEAD',
    );
    expect(workflow).to.not.include(
      'git diff --name-only "${RELEASE_TAG}^{commit}" HEAD',
    );
    expect(workflow).to.not.include('git diff --name-only "${BEFORE_SHA}" HEAD');
  });

  it('does not short-circuit a large changed-file list under pipefail', () => {
    expect(workflow).to.include('grep -qE');
    expect(workflow).to.include('<<< "${CHANGED}"');
    expect(workflow).to.not.include('echo "${CHANGED}" | grep -qE');
  });

  it('records only an owned or ambiguously successful tag before rebuilding', () => {
    const remoteProof = workflow.indexOf(
      'if [ "${REMOTE_OBJECT}" = "${LOCAL_TAG_OBJECT}" ]',
    );
    const ownership = workflow.indexOf('echo "reserved=${OWNED}" >> "$GITHUB_OUTPUT"');
    const rebuild = workflow.indexOf('if [ "${CANDIDATE}" != "${TAG}" ]');

    expect(remoteProof).to.be.greaterThan(-1);
    expect(ownership).to.be.greaterThan(remoteProof);
    expect(rebuild).to.be.greaterThan(ownership);
    expect(workflow).to.include(
      'Push response was ambiguous, but this run\'s unique tag object exists remotely.',
    );
    expect(workflow).to.include(
      'Tag ${CANDIDATE} is reserved by another run; selecting a new version.',
    );
    expect(workflow).to.include(
      '--force-with-lease="refs/tags/${CANDIDATE}:"',
    );
    expect(workflow).to.include('git tag -a "${CANDIDATE}" "${COMMIT_SHA}"');
    expect(workflow).to.include('echo "tag_object=${OWNED_OBJECT}"');
    expect(workflow).to.include('GIT_COMMITTER_NAME: github-actions[bot]');
    expect(workflow).to.include(
      'GIT_COMMITTER_EMAIL: 41898282+github-actions[bot]@users.noreply.github.com',
    );
    expect(workflow).to.include(
      'git ls-remote --refs origin "refs/tags/${CANDIDATE}"',
    );
  });

  it('does not use another run\'s tag reservation', () => {
    expect(workflow).to.not.include(
      'Tag ${CANDIDATE} already names ${COMMIT_SHA} through another object',
    );
    expect(workflow).to.not.include('REMOTE_COMMIT="${REMOTE_PEELED:-${REMOTE_OBJECT}}"');
  });

  it('keeps a replacement reservation when stale cleanup loses its lease', function () {
    this.timeout(10000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tag-race-'));
    const origin = path.join(root, 'origin.git');
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    const tag = 'v9.9.9';
    const ref = `refs/tags/${tag}`;

    try {
      git(['init', '--bare', origin]);
      git(['init', first]);
      git(['config', 'user.name', 'release test'], first);
      git(['config', 'user.email', 'release-test@example.invalid'], first);
      fs.writeFileSync(path.join(first, 'registry.json'), '{}\n');
      git(['add', 'registry.json'], first);
      git(['commit', '-m', 'seed release test'], first);
      git(['remote', 'add', 'origin', origin], first);
      git(['push', 'origin', 'HEAD:main'], first);
      git(['clone', '--branch', 'main', origin, second]);
      git(['config', 'user.name', 'release test'], second);
      git(['config', 'user.email', 'release-test@example.invalid'], second);

      git(['tag', '-a', tag, '-m', 'reservation for run one'], first);
      git(['tag', '-a', tag, '-m', 'reservation for run two'], second);
      const firstObject = git(['rev-parse', ref], first);
      const secondObject = git(['rev-parse', ref], second);
      expect(secondObject).to.not.equal(firstObject);

      git(['push', `--force-with-lease=${ref}:`, 'origin', `${ref}:${ref}`], first);
      expect(() => {
        git(['push', `--force-with-lease=${ref}:`, 'origin', `${ref}:${ref}`], second);
      }).to.throw();

      git(['push', '--force', 'origin', `${ref}:${ref}`], second);
      expect(git(['ls-remote', '--refs', 'origin', ref], second)).to.contain(secondObject);
      expect(() => {
        git(['push', `--force-with-lease=${ref}:${firstObject}`, 'origin', `:${ref}`], first);
      }).to.throw();
      expect(git(['ls-remote', '--refs', 'origin', ref], first)).to.contain(secondObject);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
    expect(workflow).to.include(
      'is already published and complete; preserving it and tag',
    );
    expect(workflow).to.include('is public but incomplete; removing it');
    expect(workflow).to.not.include('.draft // true');
  });

  it('deletes an owned failed tag with an atomic lease', () => {
    expect(workflow).to.include(
      'git push --force-with-lease="refs/tags/${TAG}:${TAG_OBJECT}"',
    );
    expect(workflow).to.include(
      'if [ "${REMOTE_OBJECT}" != "${TAG_OBJECT}" ]',
    );
    expect(workflow).to.include(
      'git ls-remote --refs origin "refs/tags/${TAG}"',
    );
  });
});
