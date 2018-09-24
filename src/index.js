const crypto = require('isomorphic-webcrypto');
const argon2 = require('argon2-wasm');
const nacl = require('tweetnacl');
const bip32 = require('bip32');
const lodash = require('lodash');

/**
 * Split a string at the provided index, returning both chunks.
 * @param  {string}  string a string
 * @param  {integer}  index the index to split at
 * @return  {array of strings}  the split string
 */
const splitAt = (index, str) => [str.slice(0, index), str.slice(index)];



/**
 * Wraps Buffer.from(). Converts an array into a buffer.
 * @param  {array} arr
 * @return {buffer}
 */
const bufferFrom = arr => Buffer.from(arr);



/**
 * Wraps Buffer.concat(). Merges buffers into one buffer.
 * @param  {array of buffers} arr
 * @return {buffer}
 */
const bufferConcat = arr => Buffer.concat(arr);



/**
 * Wraps array.reverse
 * @param  {array} arr
 * @return {array}
 */
const reverse = arr => arr.reverse();



/**
 * if any is undefined, return d. Otherwise return any
 * @param  {any} a value to check if defined
 * @param  {any} d   value to swap in if undefined.
 * @return {any}  either a or d
 */
const defaultTo = (a, d) => isUndefined(a) ? d : a;



/**
 * get a value from an object with a key. If no value is found or object is
 * undefined, return d
 * @param  {object} o The object to pull from.
 * @param  {string} k The key to use.
 * @param  {any} d The default value to swap in eith o or k is undefined.
 * @return {any}
 */
const get = (o, k, d) => {
  if (isUndefined(o)) return d;
  const r = o[k];
  return isUndefined(r) ? d : r;
};



/**
 * returns true if a is undefined, false if not.
 * @param  {any}  a the value to check
 * @return {Boolean}
 */
const isUndefined = a => typeof a === 'undefined';



/**
 * returns true if a is a number, false if not.
 * @param  {any}  any the value to check
 * @return {Boolean}
 */
const isNumber = a => typeof a === 'number' && isFinite(a);



/**
 * Converts a buffer to hexidecimal string
 * @param  {buffer} buffer
 * @return {string}
 */
const buf2hex = buffer => {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};



/**
 * Converts a hexidecimal string to a buffer.
 * @param  {string} a hex-encoded string
 * @return {Buffer}
 */
const hex2buf = hex => {
  return Buffer.from(hex, 'hex');
};



/**
 * executes SHA-512 on any size input
 * @param  {array, arrayBuffer, buffer} args any number of arguments
 * @return {Promise => arrayBuffer} Promise that resolves to arrayBuffer
 */
const hash = async (...args) => {
  // map args into buffers and concat into one buffer
  const buffer = bufferConcat(args.map(a => bufferFrom(a)));
  // generate a SHA-512 hash from input buffer
  return crypto.subtle.digest({ name: 'SHA-512' }, buffer);
};



/**
 * Runs argon2wasm to return a seed of desired bytes
 * @param  {string, Uint8Array} entropy ticket bytes as string or Uint8Array
 * or Buffer, at least 16 bytes
 * @param  {int} seedSize desired size of the generated seeds in bytes
 * @return {Promise => arrayBuffer} Promise that resolves to arrayBuffer
 */
const argon2u = (entropy, seedSize) => argon2({
  pass: entropy, // string or Uint8Array
  salt: 'urbitkeygen',
  type: 10, // argon2.ArgonType.Argon2u,
  hashLen: seedSize,
  // distPath: 'node_modules/argon2-wasm/dist',
  parallelism: 4,
  mem: 512000,
  time: 1,
});



/**
 * Derive a new seed from a seed. Uses a config with the following entries:
 * @param  {buffer}   seed seed to derive from.
 * @param  {string}   type the type of the seed we want to derive:
 * ("transfer", "spawn", "delegate", "manage", "network").
 * @param  {object}   revision the revision number of the seed we want to derive.
 * @param  {integer}  ship  optional ship number we want to derive the seed for.
 * @param  {string}   password  optional password to salt the seed with before
 * deriving.
 * @return {buffer} a new seed
 */
const childSeedFromSeed = async config => {
  const { seed, type, revision, ship, password } = config;

  const salt = isNumber(ship)
    ? `${type}-${revision}-${ship}`
    : `${type}-${revision}`;

  const childSeed = await hash(seed, salt, defaultTo(password, ''));

  return childSeed.slice(0, seed.length || seed.byteLength);
};



/**
 * Derive a new node from a seed. Uses a config with the following entries:
 * @param  {buffer}   seed seed to derive from.
 * @param  {string}   type the type of the seed we want to derive:
 * ("transfer", "spawn", "delegate", "manage", "network").
 * @param  {object}   revision the revision number of the seed we want to derive.
 * @param  {integer}  ship  optional ship number we want to derive the seed for.
 * @param  {string}   password  optional password to salt the seed with before
 * deriving.
 * @return {buffer} a new node
 */
const childNodeFromSeed = async config => {
  const { seed, type, revision, ship, password } = config;
  const childSeed = await childSeedFromSeed({seed, type, revision, ship, password});
  const childSeedBuffer = buf2hex(childSeed);
  return {
    meta: {
      type,
      revision: defaultTo(revision, 0),
      ship: !isUndefined(ship)
        ? ship
        : null
    },
    seed: childSeedBuffer,
    keys: await walletFromSeed(childSeedBuffer, password),
  };
};



/**
 * Derive a BIP32 master node from a seed.
 * @param  {buffer}  seed     seed to derive from.
 * @param  {string}  password optional password to salt the seed with before
 * deriving.
 * @return {Promise => object} a wallet derived according to BIP32 from the SHA-512 hash of
 *  the seed+password.
 */
const walletFromSeed = async (seed, password) => {
  // we hash the seed with SHA-512 before doing BIP32 wallet generation,
  // because BIP32 doesn't support seeds of bit-lengths < 128 or > 512.
  const seedHash = await hash(seed, defaultTo(password, ''));
  const { publicKey, privateKey, chainCode } = bip32.fromSeed(bufferFrom(seedHash));
  return {
    public: buf2hex(publicKey),
    private: buf2hex(privateKey),
    chain: buf2hex(chainCode),
  };
};



/**
 * Wraps nacl.lowlvel.crypto_hash
 * @param  {Uint8Array} seed
 * @return {array}
 */
const naclHash = seed => {
  let newHash = []
  nacl.lowlevel.crypto_hash(newHash, seed.reverse(), seed.length)
  return newHash
}



/**
 * Derive Urbit network keypairs from a seed. Matches ++pit:nu:crub:crypto
 * @param  {buffer} seed     seed to derive from
 * @param  {string} password optional password to salt the seed before deriving
 * @return {object} urbitKeys, derived according to ++pit:nu:crub:crypto.
 */
const urbitKeysFromSeed = (seed, password) => {
  const h = naclHash(bufferConcat([seed, password]));

  const c = h.slice(32);
  const a = h.slice(0, 32);

  const crypt = nacl.sign.keyPair.fromSeed(bufferFrom(c));
  const auth = nacl.sign.keyPair.fromSeed(bufferFrom(a));

  return {
    crypt: {
      private: buf2hex(reverse(c)),
      public: buf2hex(reverse(crypt.publicKey)),
    },
    auth: {
      private: buf2hex(reverse(a)),
      public: buf2hex(reverse(auth.publicKey)),
    }
  };
};



/**
 * Reduce a collection of arrays by recursive applications of bytewise XOR.
 * @param  {array of array of integers}  arrays an array of arrays
 * @return {array} the resulting array
 */
const reduceByXor = (arrays) => {
  return arrays.reduce((acc, arr) =>
    lodash.zipWith(acc, arr, (x, y) => x ^ y));
}



/**
 * Encode a hex string as three shards, such that any two shards can be
 * combined to recover it.
 * @param  {string}  string hex-encoded string
 * @return {array of strings} resulting shards
 */
const shard = (hex) => {
  const buffer = hex2buf(hex);
  const sharded = shardBuffer(buffer);
  return sharded.map(pair =>
           lodash.reduce(pair, (acc, arr) =>
             acc + buf2hex(bufferFrom(arr)), ''))
}



/**
 * Produce three shards from a buffer such that any two of them can be used to
 * reconstruct it.
 * @param  {buffer}  buffer arbitrary buffer
 * @return {array of array of integers} sharded buffer
 */
const shardBuffer = (buffer) => {
  const r1 = crypto.getRandomValues(new Uint8Array(buffer.length));
  const r2 = crypto.getRandomValues(new Uint8Array(buffer.length));

  const k  = Array.from(buffer);
  const k1 = Array.from(r1);
  const k2 = Array.from(r2);

  const k0 = reduceByXor([k, k1, k2]);

  const shard0 = [k0, k1];
  const shard1 = [k0, k2];
  const shard2 = [k1, k2];

  return [shard0, shard1, shard2];
};



/**
 * Combine pieces of a sharded buffer together to recover the original buffer.
 * @param  {array of array of integers}  shards a collection of shards
 * @return {buffer} the unsharded buffer
 */
const combineBuffer = (shards) => {
  const flattened = lodash.flatten(shards);
  const uniques = lodash.uniqWith(flattened, lodash.isEqual);
  const reduced = reduceByXor(uniques);
  return bufferFrom(reduced);
}



/**
 * Combine shards together to reconstruct a secret.
 * @param  {array of array of strings}  shards a collection of hex-encoded
 *  shards
 * @return {string} the reconstructed secret
 */
const combine = (shards) => {
  const splat = shards.map(shard =>
    splitAt(shard.length / 2, shard));
  const buffers = splat.map(pair =>
    pair.map(buf => Array.from(hex2buf(buf))));
  const combined = combineBuffer(buffers);
  return buf2hex(combined);
}



/**
 * Convert a full wallet into a sharded wallet.  Transforms the owner's seed
 * into a number of shards, of which only a subset are required in order to
 * reconstruct the original.
 *
 * @param  {object}  wallet full HD wallet
 * @return  {object} an object representing a sharded full HD wallet
 */
const shardWallet = (wallet) => {
  const walletCopy = lodash.cloneDeep(wallet);
  const sharded = shard(walletCopy.owner.seed)
  walletCopy.owner.seed = sharded;
  return walletCopy;
}



/**
 * Derive all keys from the ticket.
 * @param  {string, Uint8Array, buffer}  ticket ticket, at least 16 bytes.
 * @param  {integer}  seedSize desired size of the generated seeds in bytes.
 * @param  {array of integers}  ships array of ship-numbers to generate keys for.
 * @param  {string}  password optional password to use during derivation.
 * @param  {object}  revisions optional revision per key purpose:
 * (transfer, spawn, delegate, manage, network), defaults to all-zero
 * @return {Promise => object} an object representing a full HD wallet.
 */
const fullWalletFromTicket = async config => {
  const { ticket, seedSize, ships, password, revisions, boot } = config;
  const seed = await argon2u(ticket, seedSize).hash;
  return fullWalletFromSeed(bufferFrom(seed), ships, password, revisions, boot);
}



/**
 * Derive all keys from a seed.
 * @param  {string, Uint8Array, buffer}  ownerSeed ticket, at least 16 bytes.
 * @param  {array of integers}  ships array of ship-numbers to generate keys for.
 * @param  {string}  password optional password to use during derivation.
 * @param  {object}  revisions optional revision per key purpose:
 * (transfer, spawn, delegate, manage, network), defaults to all-zero
 * @return {Promise => object} an object representing a full HD wallet.
 */
const fullWalletFromSeed = async config => {
  const { ownerSeed, ships, password, revisions, boot } = config;

  // Normalize revisions object
  const _revisions = {
    transfer: get(revisions, 'transfer', 0),
    spawn: get(revisions, 'spawn', 0),
    delegate: get(revisions, 'delegate', 0),
    manage: get(revisions, 'manage', 0),
    network: get(revisions, 'network', 0),
  };

  const ownershipNode = {
    keys: await walletFromSeed(ownerSeed, password),
    seed: buf2hex(ownerSeed),
  }

  const managementNode = await childNodeFromSeed({
    seed: ownerSeed,
    type: 'manage',
    revision: _revisions.manage,
    ship: null,
    password: password,
  });

  const delegateNode = await childNodeFromSeed({
    seed: ownerSeed,
    type: 'delegate',
    revision: _revisions.delegate,
    ship: null,
    password: password,
  });

  const transferNodes = await Promise.all(ships.map(ship => childNodeFromSeed({
    seed: ownerSeed,
    type: 'transfer',
    revision: _revisions.transfer,
    ship: ship,
    password: password,
  })));

  const spawnNodes = await Promise.all(ships.map(ship => childNodeFromSeed({
    seed: ownerSeed,
    type: 'spawn',
    revision: _revisions.spawn,
    ship: ship,
    password: password,
  })));


  let networkSeeds = [];
  let networkNodes = [];

  if (boot === true) {

    networkSeeds = await Promise.all(ships.map(ship => childSeedFromSeed({
      seed: bufferFrom(managementNode.seed),
      type: 'network',
      revision: _revisions.network,
      ship: ship,
      password: password,
    })));

    networkNodes = await Promise.all(networkSeeds.map((seed, index) => ({
      seed: buf2hex(seed),
      keys: urbitKeysFromSeed(bufferFrom(seed), bufferFrom(defaultTo(password, ''))),
      meta: {
        type: 'network',
        revision: _revisions.network,
        ship: ships[index],
      }
    })));
  };

  const wallet = {
    owner: ownershipNode,
    delegate: delegateNode,
    manage: managementNode,
    network: networkNodes,
    transfer: transferNodes,
    spawn: spawnNodes,
  };

  return wallet;
}

const _buf2hex = buf2hex;
const _hex2buf = hex2buf;
const _hash = hash;
const _argon2 = argon2;
const _defaultTo = defaultTo;
const _get = get;
const _shardBuffer = shardBuffer;
const _combineBuffer = combineBuffer;
const _shard = shard;
const _combine = combine;

module.exports = {
  argon2u,
  fullWalletFromTicket,
  fullWalletFromSeed,
  childNodeFromSeed,
  childSeedFromSeed,
  walletFromSeed,
  urbitKeysFromSeed,
  shardWallet,
  _buf2hex,
  _hex2buf,
  _hash,
  _argon2,
  _defaultTo,
  _get,
  _shardBuffer,
  _combineBuffer,
  _shard,
  _combine
}
