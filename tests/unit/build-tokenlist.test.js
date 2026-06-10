/**
 * Unit tests for the tokenlist builder (addresses AUD-07). Confirms the output
 * is Uniswap-tokenlist-shaped, deterministic, and pins logo/list URLs to a ref.
 */

const { expect } = require('chai');
const { buildTokenList, parseSemver } = require('../../scripts/build-tokenlist');

describe('build-tokenlist', () => {
  describe('parseSemver', () => {
    it('parses x.y.z', () => {
      expect(parseSemver('1.2.3')).to.deep.equal({ major: 1, minor: 2, patch: 3 });
    });
    it('defaults to 0.0.0 on garbage', () => {
      expect(parseSemver('not-a-version')).to.deep.equal({ major: 0, minor: 0, patch: 0 });
    });
  });

  describe('buildTokenList', () => {
    const list = buildTokenList('v9.9.9');

    it('produces a Uniswap-tokenlist shape', () => {
      expect(list).to.have.property('name');
      expect(list).to.have.property('timestamp');
      expect(list).to.have.property('version');
      expect(list.version).to.have.all.keys('major', 'minor', 'patch');
      expect(list.tokens).to.be.an('array').with.length.greaterThan(0);
    });

    it('every token carries chainId/address/symbol/name/decimals', () => {
      for (const t of list.tokens) {
        expect(t).to.include.all.keys('chainId', 'address', 'symbol', 'name', 'decimals');
        expect([206, 207]).to.include(t.chainId);
      }
    });

    it('is sorted by (chainId, address)', () => {
      const sorted = [...list.tokens].sort(
        (a, b) => a.chainId - b.chainId || a.address.localeCompare(b.address)
      );
      expect(list.tokens).to.deep.equal(sorted);
    });

    it('pins the list logoURI to the provided ref', () => {
      expect(list.logoURI).to.include('/v9.9.9/');
    });

    it('is deterministic for the same ref (ignoring timestamp)', () => {
      const a = buildTokenList('v1.0.0');
      const b = buildTokenList('v1.0.0');
      delete a.timestamp;
      delete b.timestamp;
      expect(a).to.deep.equal(b);
    });
  });
});
