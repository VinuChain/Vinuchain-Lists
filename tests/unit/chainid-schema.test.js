/**
 * Unit tests for the mandatory chainId field on token and contract entries
 * (addresses AUD-05). Validates the compiled JSON schemas directly so the
 * requirement is enforced independently of validate.js wiring.
 */

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const tokenSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../schemas/token.schema.json'), 'utf8')
);
const contractSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../schemas/contract.schema.json'), 'utf8')
);

const validateToken = ajv.compile(tokenSchema);
const validateContract = ajv.compile(contractSchema);

// codeHash is a required identity pin (keccak256 of deployed bytecode); a
// valid 32-byte hex placeholder keeps these schema fixtures well-formed.
const CODEHASH = '0x' + '11'.repeat(32);

const baseToken = {
  symbol: 'USDT',
  name: 'USDT@VinuChain',
  address: '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41',
  decimals: 6,
  chainId: 207,
  codeHash: CODEHASH,
};

const baseContract = {
  name: 'VinuChain',
  website: 'https://vinuchain.com',
  contracts: [
    {
      name: 'SFC',
      address: '0xFC00FACE00000000000000000000000000000000',
      type: 'staking',
      chainId: 207,
      codeHash: CODEHASH,
    },
  ],
};

describe('chainId schema enforcement', () => {
  describe('token schema', () => {
    it('accepts a token with chainId 207', () => {
      expect(validateToken({ ...baseToken, chainId: 207 })).to.be.true;
    });

    it('accepts a token with chainId 206', () => {
      expect(validateToken({ ...baseToken, chainId: 206 })).to.be.true;
    });

    it('rejects a token missing chainId', () => {
      const { chainId, ...withoutChainId } = baseToken;
      expect(validateToken(withoutChainId)).to.be.false;
      expect(validateToken.errors.some(e => /chainId/.test(JSON.stringify(e)))).to.be.true;
    });

    it('rejects a token with an out-of-enum chainId', () => {
      expect(validateToken({ ...baseToken, chainId: 1 })).to.be.false;
      expect(validateToken({ ...baseToken, chainId: 205 })).to.be.false;
    });

    it('rejects a token with a non-integer chainId', () => {
      expect(validateToken({ ...baseToken, chainId: '207' })).to.be.false;
    });
  });

  describe('contract schema', () => {
    it('accepts a contract with chainId 207', () => {
      expect(validateContract(baseContract)).to.be.true;
    });

    it('accepts a contract with chainId 206', () => {
      const testnet = {
        ...baseContract,
        contracts: [{ ...baseContract.contracts[0], chainId: 206 }],
      };
      expect(validateContract(testnet)).to.be.true;
    });

    it('rejects a contract missing chainId', () => {
      const { chainId, ...contractWithoutChain } = baseContract.contracts[0];
      const project = { ...baseContract, contracts: [contractWithoutChain] };
      expect(validateContract(project)).to.be.false;
      expect(validateContract.errors.some(e => /chainId/.test(JSON.stringify(e)))).to.be.true;
    });

    it('rejects a contract with an out-of-enum chainId', () => {
      const project = {
        ...baseContract,
        contracts: [{ ...baseContract.contracts[0], chainId: 1 }],
      };
      expect(validateContract(project)).to.be.false;
    });
  });

  describe('real registry entries', () => {
    it('every token JSON carries a valid chainId', () => {
      const tokensDir = path.join(__dirname, '../../tokens');
      const dirs = fs.readdirSync(tokensDir).filter(d => d.startsWith('0x'));
      expect(dirs.length).to.be.greaterThan(0);
      for (const dir of dirs) {
        const token = JSON.parse(
          fs.readFileSync(path.join(tokensDir, dir, `${dir}.json`), 'utf8')
        );
        expect([206, 207], `token ${dir}`).to.include(token.chainId);
      }
    });

    it('every contract entry carries a valid chainId', () => {
      const contractsDir = path.join(__dirname, '../../contracts');
      const projects = fs.readdirSync(contractsDir).filter(p => {
        try {
          return fs.statSync(path.join(contractsDir, p, 'info.json')).isFile();
        } catch {
          return false;
        }
      });
      expect(projects.length).to.be.greaterThan(0);
      for (const project of projects) {
        const info = JSON.parse(
          fs.readFileSync(path.join(contractsDir, project, 'info.json'), 'utf8')
        );
        for (const contract of info.contracts) {
          expect([206, 207], `${project}/${contract.name}`).to.include(contract.chainId);
        }
      }
    });
  });
});
