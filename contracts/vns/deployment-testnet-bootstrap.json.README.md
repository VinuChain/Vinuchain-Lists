# Testnet bootstrap rehearsal — NOT the live VNS stack

`deployment-testnet-bootstrap.json` records a **parallel, throwaway** VNS stack deployed on
testnet on 2026-08-21 to prove `scripts/bootstrap-vns.js` end to end before it is ever pointed at
mainnet.

It is independent of the live testnet VNS (its own ENSRegistry and Root), touches nothing the
live stack owns, and is not listed in `contracts/vns/info.json`. The live testnet deployment
remains `deployment-testnet.json`.

Do not treat these addresses as canonical for anything.
