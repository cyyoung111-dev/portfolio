import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {assertCurrentMainRelease} from './gas-release-gate.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';

const SCRIPT_API = 'https://script.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SOURCE_PATH = 'src/gas/apps_script.gs';

function env(name, { required = true } = {}) {
  const value = String(process.env[name] || '').trim();
  if (required && !value) throw new Error(`필수 환경변수 누락: ${name}`);
  return value;
}

export function extractExpectedGasVersion(source) {
  const header = String(source || '').match(/Google Apps Script\s+v(\d+\.\d+)/);
  if (!header) throw new Error('GAS 소스 헤더에서 버전을 찾지 못했습니다.');
  const version = header[1];
  const refs = [...String(source).matchAll(/gasVersion:\s*['"](\d+\.\d+)['"]/g)].map(match => match[1]);
  if (!refs.length) throw new Error('GAS 응답의 gasVersion 값을 찾지 못했습니다.');
  const mismatched = refs.filter(value => value !== version);
  if (mismatched.length) throw new Error(`GAS 버전 불일치: header=${version}, response=${[...new Set(refs)].join(',')}`);
  return version;
}

// A production GAS release must match an explicitly reviewed, complete
// source blob. A function name, comment, or version string is not evidence
// that the stacked KRX/NAV/Snapshot implementations are present.
//
// Pinned Git blob IDs refer to exact reviewed full-file GAS source content.
// The 9.278 auth-cache rollout preserves both the prior deployed source and
// the new PR #727 source, so strict pre-deploy drift checks can transition.
// Do not allow other SHA variants without explicit full-source review.
// Unknown future versions fail closed rather than bypassing this contract.
const REVIEWED_GAS_SOURCE_BLOBS = Object.freeze({
  '9.281': 'ebe697563e94cf49e514037353260fce70ae1d57',
  '9.280': 'abea936330401d5418817367f9f046d9db90e800',
  '9.279': '0eef172226b95bf32c05036955c9a1fa432b636f',
  '9.278': Object.freeze(['e383b7c3809ce6426aa3d502bb6c22a6bb175dbf','c77c539568f2dc3b2af4bcb729e8e38bbf6cee82','dca53650aae621c3d9efb97d677dfb763f48b84d','85e5a73565344b24007e81acd80db2b3a1067e46','df680956105a1184a9fdacfc41725626f7b74d72']),
  '9.277': 'e8d762248ca0e33d3a9031b16dd3f7b7d6d260e6',
  '9.276': '3c39d3689c84671ddd42265e5c7e84c5d20f90f5',
  '9.275': '59266e9dfa486c049634310b7f0fbea2320f4d08',
  '9.274': '723ad4db070858d1f879c733db68aec6d1a6a709',
  '9.273': '6a47e4b1e23fa18f59a5e71fb027219f57c2c0c0',
  '9.272': '72143c4490565a686ec04ec01353686ee8a36d85',
  '9.271': 'f6c99ff27a5f5289f2a19e8a8a8dfd6c27e1a85d',
  '9.270': '291a05d20f4bbc92275dbb804856ce72b5446bbe',
  '9.269': '09bfae99349d66412d22b96206137534e61f2b7e',
  '9.268': '990df4a7da174da8ceb36065487c205d4314c7c0',
  '9.267': 'a23139e617b50c72645e0adf35809a6c282d1226',
  '9.266': '9b9fe7cb50b55d841ff83295962ffdc5957ee606',
  '9.265': 'c5da19150fd0beae6b50e5aa230b576592506ae9',
  '9.264': 'e9ddeed5029420d1758375689c0c41014364ad0c',
  '9.256': 'ec9a8f7d10fc5af768355c350f532e8072a81ef6',
  '9.257': '8ae1913bc04946c49fa0ee686c05c77f9fc8d965',
  '9.258': 'ae155c0b45dadeb2f55bc3442fdf371baac0fe37',
  '9.263': '7b9863f8b861ae0bac7cf3d45d6f490bfa36e65d',
  '9.262': 'bd711ae112404e626439db4cc07d54407aebb8d7',
  '9.261': 'c3ac85786ce987aeb6ec895baa82754dcfabee42',
  '9.260': '6fc3a09b27f9d2e8bede794a762b2f3c53eacdb4',
  '9.259': 'f6e2161aec5cc9813d3300be0181661e5267ad24',
  '9.255': 'd74f4b7fdbef6952bbd2ce77e42a5c3db63e0ad2',
  '9.193': '811ef56ede77cd040819941e73e4729826de935b',
  '9.194': '8082cf7b1f988b008799f8be1439cf4d54a3b51e',
  '9.195': '3ec29f63058b7f12eacb2de32303e65c2584b4ac',
  '9.196': '820e28103cf5b871dcccf4d03f5ab768bec6dcda',
  '9.197': '0d7eec10b1e1ff848b302e84db908196f4ef62eb',
  '9.198': 'e74b4450aa3b8bc48264c8aa6ce24337d88687f2',
  '9.199': '852c26bbaf5312f8aa447f5f1d03a8932a85b3f8',
  '9.200': '3eb6b4ad640b85f0648f16e3571099e5c374368a',
  '9.201': 'd3d4ce4a9f7db4096f99b8b214dad959736ecb5f',
  '9.202': '23dd4fa2c455c315d6925d57f3bdfe5baec40aeb',
  '9.203': '7e673bbb7349931935c3db6510cb9ddee1adbb6e',
  '9.204': 'b4a81fafcd87dd101c625087c6df5323ab0df069',
  '9.205': '120593344d2b9da89f3e603bdb2349fc3ef571f9',
  '9.206': 'f096c726eac791fc49f6bf19e0533ed58a4ed69a',
  '9.207': '23d04044aff5e9390855bdc219eda6aa03b04291',
  '9.208': '2cee1e67fd0283f4c5fd7119424f1b82b4159ec5',
  '9.209': '2eeaa55461a8f9f69e017655be402a83d859faad',
  '9.210': '86cbc5e7a140b66b3f4c5543a73c90b573479b9c',
  '9.211': '1985fbbe0a351074ac9ee9bfabbdc787ec99a672',
  '9.212': 'b2f2f94e1f6790a31988c2931fb124aff891da05',
  '9.213': '09f660249362cde7726a7a4c9a8cb32e3fcafb95',
  '9.214': '1a70dc5bf7b3c24e2812f154b4d997e92a557d5d',
  '9.215': '6ddf0ea51184002277c25a4231e5618008beeb0e',
  '9.216': 'dc83f340fa21545cde53cbbe0aefca4213543dda',
  '9.217': 'a034df2b2a47128e6972734803edf5cb9c9e910f',
  '9.218': 'd04ceccdd022acb0b41be544e1861eb4b59b7f8c',
  '9.219': 'ee9c730597db65860590ea2f3ddaafb733762a5d',
  '9.220': '2d5c54a6900ad0935f4d0e226e8cfe207c91506c',
  '9.221': '8db187d38a9195de241ee9dae3b3f8ed1632f062',
  '9.222': '976dfda019d4238515428951482499caf5002c7f',
  '9.223': '1a63bbec340754a6e93f3d1531732b9d0fb9acb8',
  '9.224': '1eddb8c3ac348751742ebf1617ca20295ee3a2a9',
  '9.225': '755977e5b21a8a97f2a67e0ded27b90a988dbb1d',
  '9.226': 'e420e6b0b71135206d379b89fadfc01df2fe6c85',
  '9.227': 'd203cc71b9766594ea0b82fa75a2d69e4126b030',
  '9.228': 'c326fc480dca53de86f72938f9585dc61f995422',
  '9.229': '36f4ba41d67b9a82594b2c46584fa1d67990b253',
  '9.254': '1f44d05f179cd20b27e12130003d1d1fd25197f2',
  '9.253': '89bd4a6a7c13dde9f758bb110c0cdfd94e98a530',
  '9.252': '6b7596a1f202e98f9f9d6ccee7196d835eceebc5',
  '9.251': '9c5d0bd6be276682e63bab691d0d4adbf165d229',
  '9.250': 'e300760560e763503439eb8a827891694baeaddb',
  '9.249': 'f250e9474447a73877f4fee3ad23b7a0fd6f2363',
  '9.248': '17ab235f10940f6020fd421f9afceae573e7a685',
  '9.247': '6c1114ecad634f05a6d84912e3b5d44bb5ed40e5',
  '9.246': '0ba7d0d30de93fcd0ec4528fadf25816a9ffccf9',
  '9.245': '940998491bd1f8261e20d887285b269b526a9f21',
  '9.244': '758e5e4da5d32252af3472e248ca023004cf4e4b',
  '9.243': 'a28be0795b820e96c2659a2d96e030fecaba4f94',
  '9.242': 'b530a305c6b3056b5e75cc8da47dbe1b078ce4c4',
  '9.241': '761db12b1b35e3212774cdeaf4485f6ae181cc0f',
  '9.240': '98c20f52807530933a74827476c86b5713f3254f',
  '9.239': 'ed555bd181c57ab2e8bf2102938c0089d6df2937',
  '9.238': '134ae6e83b28f8b8772a411b2685e228f3af2388',
  '9.237': 'd68e38126a2905ebcd6b90931489624a65d9d272',
  '9.236': '54840112e1ffa3292edda154d07e0a8b22747933',
  '9.235': '720cfac39781a85d4578e11b21bff2b9b3ec3db3',
  '9.234': '7a4986700e3d9c2285f185f4f724902cb151ee9f',
  '9.233': '3f7d34c3680c737b4f21c09540fa46d2a17eadb4',
  '9.232': 'e2d6094e78c5c8867d7219f038e5f3b6f440d554',
  '9.231': '815c0b60e4d54ef04c05dd2d618e6bce052d41d6',
  '9.230': '66d2cdc9c29ea8040e95487f9b39bbe39e38eb27',
});

export function gasSourceBlobSha(source) {
  const bytes = Buffer.from(String(source ?? ''), 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function assertGasReleaseReady(source) {
  const version = extractExpectedGasVersion(source);
  // Older and newer versions alike require an explicit reviewed source pin.
  // Rollbacks must also be approved rather than bypassing release integrity.
  const reviewed = REVIEWED_GAS_SOURCE_BLOBS[version];
  if (!reviewed) throw new Error(`GAS_RELEASE_UNREVIEWED_VERSION: ${version}`);
  const actual = gasSourceBlobSha(source);
  const approvedBlobs = Array.isArray(reviewed) ? reviewed : [reviewed];
  if (!approvedBlobs.includes(actual)) {
    throw new Error(`GAS_RELEASE_SOURCE_NOT_APPROVED: version=${version} actualBlob=${actual} reviewedBlobs=${approvedBlobs.join(',')}`);
  }
  return version;
}

export function deploymentIdFromWebAppUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); }
  catch { throw new Error('GAS_WEB_APP_URL이 올바른 URL이 아닙니다.'); }
  const match = url.pathname.match(/\/macros\/s\/([^/]+)\/(?:exec|dev)\/?$/);
  if (!match) throw new Error('GAS_WEB_APP_URL에서 deployment ID를 찾지 못했습니다.');
  return match[1];
}

export function selectServerFile(files, preferredName = '') {
  const serverFiles = (files || []).filter(file => file && file.type === 'SERVER_JS');
  if (preferredName) {
    const selected = serverFiles.find(file => file.name === preferredName);
    if (!selected) throw new Error(`GAS_SERVER_FILE_NAME=${preferredName}에 해당하는 SERVER_JS 파일이 없습니다. 현재: ${serverFiles.map(file => file.name).join(', ') || '없음'}`);
    return selected;
  }
  const conventional = serverFiles.find(file => file.name === 'apps_script');
  if (conventional) return conventional;
  if (serverFiles.length === 1) return serverFiles[0];
  throw new Error(`배포 대상 SERVER_JS 파일을 하나로 결정할 수 없습니다. GAS_SERVER_FILE_NAME을 설정하세요. 현재: ${serverFiles.map(file => file.name).join(', ') || '없음'}`);
}

export function sanitizeFiles(files) {
  return (files || []).map(file => ({
    name: file.name,
    type: file.type,
    source: String(file.source ?? ''),
  }));
}

// Fail closed on unreviewed executable files. Apps Script compiles every
// SERVER_JS and HTML file within a version, not just the replaced target.
// The manifest is data, but it must match the currently deployed manifest;
// HEAD-only changes to scopes, webApp access or runtime are not approved.
export function assertGasProjectFileSet(files, targetName, deployedFiles) {
  const clean = sanitizeFiles(files);
  const deployed = sanitizeFiles(deployedFiles);
  const expectedNames = new Set(['appsscript', targetName]);
  const valid = list => list.length === 2
    && list.every(f => expectedNames.has(f.name))
    && list.filter(f => f.name === 'appsscript' && f.type === 'JSON').length === 1
    && list.filter(f => f.name === targetName && f.type === 'SERVER_JS').length === 1;
  if (!valid(clean) || !valid(deployed))
    throw new Error('GAS_PROJECT_UNREVIEWED_FILES: expected one manifest JSON and one approved SERVER_JS');
  const manifest = clean.find(f => f.name === 'appsscript').source;
  const published = deployed.find(f => f.name === 'appsscript').source;
  if (!sameSource(manifest, published))
    throw new Error('GAS_PROJECT_MANIFEST_DRIFT: HEAD manifest differs from deployed manifest');
  try {
    if (!JSON.parse(manifest) || Array.isArray(JSON.parse(manifest))) throw new Error('not an object');
  } catch (_) {
    throw new Error('GAS_PROJECT_MANIFEST_INVALID: appsscript JSON is invalid');
  }
  return true;
}

// Google Apps Script versions are minted from the mutable project HEAD.
// Validate the *created version*, not only the project state observed before
// the write. This closes a concurrent-edit window before moving /exec.
export function assertGasCreatedVersionReady(createdFiles, targetName, reviewedSource, deployedFiles) {
  assertGasProjectFileSet(createdFiles, targetName, deployedFiles);
  const versionFile = selectServerFile(createdFiles, targetName);
  if (!sameSource(versionFile.source, reviewedSource))
    throw new Error('GAS_CREATED_VERSION_SOURCE_DRIFT: created version differs from approved source');
  return true;
}

export function buildUpdatedFiles(files, targetName, source) {
  const clean = sanitizeFiles(files);
  if (!clean.some(file => file.name === 'appsscript' && file.type === 'JSON')) {
    throw new Error('Apps Script manifest(appsscript / JSON)가 없어 updateContent를 중단합니다.');
  }
  let replaced = 0;
  const updated = clean.map(file => {
    if (file.name !== targetName || file.type !== 'SERVER_JS') return file;
    replaced += 1;
    return { ...file, source };
  });
  if (replaced !== 1) throw new Error(`SERVER_JS 교체 대상 수가 ${replaced}개입니다.`);
  return updated;
}

async function requestJson(url, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  }
  const response = await fetch(url, { method, headers, body: payload, redirect: 'follow', signal:AbortSignal.timeout(60000) });
  const responseText = await response.text();
  let parsed = null;
  try { parsed = responseText ? JSON.parse(responseText) : {}; }
  catch { parsed = null; }
  if (!response.ok) {
    const detail = parsed?.error?.message || parsed?.message || responseText.slice(0, 500) || `HTTP ${response.status}`;
    const error = new Error(`${method} ${new URL(url).pathname} 실패: HTTP ${response.status} · ${detail}`);
    error.httpStatus = response.status;
    error.providerStatus = parsed?.error?.status;
    error.providerReason = /syntax error/i.test(detail) ? 'SOURCE_SYNTAX' : /too many versions|maximum.*versions|version.*limit/i.test(detail) ? 'VERSION_LIMIT' : /quota|too many requests/i.test(detail) ? 'QUOTA' : /permission|not authorized/i.test(detail) ? 'PERMISSION' : /temporar|try again|service unavailable/i.test(detail) ? 'TRANSIENT' : 'UNKNOWN';
    error.syntaxLine = /syntax/i.test(detail) ? Number(detail.match(/line[: ]+(\d+)/i)?.[1] || 0) : 0;
    throw error;
  }
  if (parsed === null) throw new Error(`${method} ${new URL(url).pathname} 응답 JSON 파싱 실패`);
  return parsed;
}

export function parseClaspCredentials(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('필수 환경변수 누락: CLASPRC_JSON');

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('CLASPRC_JSON이 올바른 JSON이 아닙니다. 최신 clasp login으로 만든 .clasprc.json 전체 내용을 저장하세요.'); }

  const normalize = credential => {
    if (!credential || typeof credential !== 'object') return null;
    const clientId = String(credential.client_id || '').trim();
    const clientSecret = String(credential.client_secret || '').trim();
    const refreshToken = String(credential.refresh_token || '').trim();
    if (!clientId || !clientSecret || !refreshToken) return null;
    return { clientId, clientSecret, refreshToken };
  };

  const v3Default = normalize(parsed?.tokens?.default);
  if (v3Default) return v3Default;

  const v3Candidates = Object.values(parsed?.tokens || {}).map(normalize).filter(Boolean);
  if (v3Candidates.length === 1) return v3Candidates[0];
  if (v3Candidates.length > 1) {
    throw new Error('CLASPRC_JSON에 여러 clasp 사용자 토큰이 있습니다. default 사용자로 clasp login하거나 default 항목만 포함해 저장하세요.');
  }

  if (parsed?.token && parsed?.oauth2ClientSettings) {
    const legacy = normalize({
      refresh_token: parsed.token.refresh_token,
      client_id: parsed.oauth2ClientSettings.clientId,
      client_secret: parsed.oauth2ClientSettings.clientSecret,
    });
    if (legacy) return legacy;
  }

  const direct = normalize(parsed);
  if (direct) return direct;

  throw new Error('CLASPRC_JSON에서 client_id/client_secret/refresh_token을 찾지 못했습니다. 최신 @google/clasp로 다시 로그인하세요.');
}

async function getAccessToken() {
  const { clientId, clientSecret, refreshToken } = parseClaspCredentials(env('CLASPRC_JSON'));
  const token = await requestJson(TOKEN_URL, {
    method: 'POST',
    form: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
  });
  if (!token.access_token) throw new Error('clasp OAuth refresh token으로 Google access token을 받지 못했습니다.');
  return token.access_token;
}

function sameSource(a, b) {
  return String(a ?? '').replace(/\r\n/g, '\n') === String(b ?? '').replace(/\r\n/g, '\n');
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function verifyPortfolioReceiptReadOnly(url, accessToken, fetchImpl = fetch) {
  const operationId = 'release_probe_' + Date.now().toString(36);
  const response = await fetchImpl(url, {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({action:'getPortfolioSyncReceipt',kind:'syncHoldings',operationId,data:'[]',
      ...(accessToken ? {accessToken} : {})}).toString(),
    redirect:'follow',signal:AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || data?.status !== 'ok'
      || !['NOT_FOUND','BUSY'].includes(data.receiptState)
      || (data.receiptState === 'NOT_FOUND' && (data.operationId !== operationId || data.kind !== 'syncHoldings')))
    throw new Error('SYNC_RECEIPT_READONLY_VERIFY_FAILED');
  return {checked:true,state:data.receiptState,dataWrites:0};
}

async function verifyWebApp(url, accessToken, expectedVersion) {
  let last = '';
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'getSettings',
          ...(accessToken ? { accessToken } : {}),
        }).toString(),
        redirect: 'follow',
        signal:AbortSignal.timeout(30000),
      });
      const responseText = await response.text();
      if (response.ok) {
        const data = JSON.parse(responseText);
        if (String(data?.gasVersion || '') === expectedVersion) {
          if (expectedVersion === '9.275') {
            if (data.portfolioSyncReceipts !== true) throw new Error('SYNC_RECEIPT_CAPABILITY_MISSING');
            const receiptCheck = await verifyPortfolioReceiptReadOnly(url, accessToken);
            console.log(JSON.stringify({portfolioReceiptReadOnly:receiptCheck}));
            return { checked:true,ok:true,attempt,gasVersion:data.gasVersion,receiptCheck };
          }
          return { checked: true, ok: true, attempt, gasVersion: data.gasVersion };
        }
        last = `gasVersion=${data?.gasVersion || '없음'}`;
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = error.message;
    }
    if (attempt < 12) await sleep(5000);
  }
  throw new Error(`배포 후 웹앱 버전 확인 실패: 기대 ${expectedVersion}, 마지막 결과 ${last}`);
}

// Apps Script deployments can lag a successful PUT by several seconds in
// list/get reads. Retry the *same* deployment GET; never POST a new version
// merely because the first read is stale. A permanent mismatch still fails.
export async function verifyDeploymentVersionWithRetry({
  readDeployment, expectedVersion, pause = sleep, maxChecks = 5,
}) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1
      || !Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 10
      || typeof readDeployment !== 'function' || typeof pause !== 'function') {
    throw new Error('GAS_DEPLOYMENT_READBACK_INVALID');
  }
  let lastVersion = 0;
  for (let check = 0; check < maxChecks; check++) {
    const result = await readDeployment();
    lastVersion = Number(result?.deploymentConfig?.versionNumber || 0);
    if (lastVersion === expectedVersion) return result;
    if (check < maxChecks - 1) await pause((check + 1) * 1500);
  }
  throw new Error(`deployment version 검증 실패: expected=${expectedVersion}, observed=${lastVersion}`);
}

// Roll back only our exact candidate. A third-party edit/version must never
// be overwritten by automatic recovery. Financial data is never restored here.
export async function rollbackGasCode({beforeFiles,candidateFiles,beforeDeployment,newVersion,
  readFiles,writeFiles,readDeployment,writeDeployment}){
  const canonical=files=>JSON.stringify(sanitizeFiles(files).map(f=>({...f,
    source:f.source.replace(/\r\n/g,'\n')})).sort((a,b)=>(a.name+a.type).localeCompare(b.name+b.type)));
  const current=await readFiles(),deployment=await readDeployment();
  const version=deployment?.deploymentConfig?.versionNumber;
  const oldVersion=beforeDeployment?.deploymentConfig?.versionNumber;
  if(!oldVersion||![oldVersion,newVersion].includes(version)
    ||![canonical(beforeFiles),canonical(candidateFiles)].includes(canonical(current)))
    throw Error('GAS_ROLLBACK_CONCURRENT_CHANGE');
  if(canonical(current)!==canonical(beforeFiles))await writeFiles(sanitizeFiles(beforeFiles));
  // A publish PUT may have committed even when its response was lost and
  // the first GET is stale. Reassert the known previous version in that case.
  if(newVersion || version!==oldVersion)await writeDeployment(beforeDeployment.deploymentConfig);
  if(canonical(await readFiles())!==canonical(beforeFiles)
    ||(await readDeployment())?.deploymentConfig?.versionNumber!==oldVersion)
    throw Error('GAS_ROLLBACK_UNVERIFIED');
  return {headRestored:true,deploymentRestored:true,dataWrites:0};
}

// Bounded operational facts only; source text, identifiers and provider messages never leave this report.
export function inspectGasReleaseState({headSource,publishedSource}) {
  function inspect(source) {
    try { return { version: assertGasReleaseReady(String(source).replace(/\r\n/g,'\n')), approved:true }; }
    catch { return { version:'UNKNOWN', approved:false }; }
  }
  return {mode:'READ_ONLY_GAS_RELEASE_STATE',head:inspect(headSource),published:inspect(publishedSource),dataWrites:0};
}
export function summarizeGasReleaseFailure(error,stage) {
  const stages=['CONTENT_WRITE','VERSION_CREATE','VERSION_READBACK','DEPLOYMENT_WRITE','DEPLOYMENT_READBACK','WEBAPP_VERIFY','AUTOMATION_VERIFY'];
  const statuses=['INVALID_ARGUMENT','PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','INTERNAL','UNAVAILABLE','NOT_FOUND'];
  // Emit only fixed classifications; never expose a provider response or error text.
  const diagnosticCodes=['AUTOMATION_DIAG_NETWORK_FAILED','AUTOMATION_DIAG_HTTP_FAILED',
    'AUTOMATION_DIAG_NON_JSON','AUTOMATION_DIAG_AUTH_DISABLED','AUTOMATION_DIAG_TOKEN_MISSING',
    'AUTOMATION_DIAG_BAD_DATE','AUTOMATION_DIAG_BAD_CHECKPOINT','AUTOMATION_DIAG_BAD_TRIGGER',
    'AUTOMATION_DIAG_BAD_QUEUE','AUTOMATION_DIAG_BAD_RESPONSE','AUTOMATION_DIAG_BAD_LEDGER_WORKER_CHECKPOINT',
    'AUTOMATION_DIAG_BAD_LEDGER_WORKER_BUSY','AUTOMATION_DIAG_BAD_WORKER_TRIGGER_AUDIT',
    'AUTOMATION_DIAG_BAD_LEDGER_WRITE','AUTOMATION_DIAG_BAD_LEDGER_PENDING',
    'AUTOMATION_DIAG_BAD_DEFERRED_COUNT','AUTOMATION_DIAG_BAD_DEFERRED_DATE',
    'AUTOMATION_DIAG_BAD_HISTORICAL_CHECKPOINT','AUTOMATION_DIAG_BAD_OBSERVATION_TIME',
    'GAS_AUTOMATION_VERSION_MISMATCH','GAS_DEPLOYMENT_READBACK_INVALID'];
  const message=typeof error?.message==='string'?error.message:'';
  const failureCode=diagnosticCodes.includes(message)?message:
    /^deployment version 검증 실패: expected=\d+, observed=\d+$/.test(message)
      ?'DEPLOYMENT_VERSION_MISMATCH':'UNKNOWN';
  return {mode:'GAS_RELEASE_FAILURE',stage:stages.includes(stage)?stage:'UNKNOWN',
    failureCode,
    httpStatus:Number.isInteger(error?.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599?error.httpStatus:null,
    providerStatus:statuses.includes(error?.providerStatus)?error.providerStatus:'UNKNOWN',
    providerReason:['SOURCE_SYNTAX','VERSION_LIMIT','QUOTA','PERMISSION','TRANSIENT'].includes(error?.providerReason)?error.providerReason:'UNKNOWN',
    syntaxLine:Number.isInteger(error?.syntaxLine)&&error.syntaxLine>0&&error.syntaxLine<100000?error.syntaxLine:null};
}

export async function deploy() {
  const dryRun = String(process.env.GAS_DEPLOY_DRY_RUN || '').toLowerCase() === 'true';
  const scriptId = env('GAS_SCRIPT_ID');
  const webAppUrl = env('GAS_WEB_APP_URL');
  const deploymentId = env('GAS_DEPLOYMENT_ID', { required: false }) || deploymentIdFromWebAppUrl(webAppUrl);
  const preferredFile = env('GAS_SERVER_FILE_NAME', { required: false });
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  // Do not publish a partial or unpinned GAS version, including on automatic main-push deploy.
  // Dry runs remain available for investigating deployment credentials.
  const expectedVersion = dryRun ? extractExpectedGasVersion(source) : assertGasReleaseReady(source);
  const sha = String(process.env.GITHUB_SHA || 'local').slice(0, 12);
  const checkCurrentMain=async()=>{
    const expected=process.env.GAS_EXPECTED_MAIN_SHA;
    if(process.env.GITHUB_ACTIONS==='true'&&!expected)throw Error('GAS_RELEASE_SHA_INVALID');
    if(expected)await assertCurrentMainRelease({sha:expected,repository:process.env.GITHUB_REPOSITORY,
      token:process.env.GITHUB_TOKEN});
  };
  await checkCurrentMain();
  const accessToken = await getAccessToken();

  const currentContent = await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content`, { token: accessToken });
  const deployment = await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, { token: accessToken });
  const target = selectServerFile(currentContent.files, preferredFile);
  const manifestFileName = String(deployment?.deploymentConfig?.manifestFileName || 'appsscript');
  const currentVersionNumber = Number(deployment?.deploymentConfig?.versionNumber || 0);
  if (!currentVersionNumber) throw new Error('현재 deployment의 versionNumber를 확인하지 못했습니다.');
  const isWebApp = (deployment.entryPoints || []).some(entry => entry?.webApp || entry?.entryPointType === 'WEB_APP');
  if (!isWebApp) throw new Error('지정한 deployment가 웹앱 배포가 아닙니다.');

  const deployedContent = await requestJson(
    `${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${currentVersionNumber}`,
    { token: accessToken },
  );
  const deployedTarget = selectServerFile(deployedContent.files, target.name);
  // Validate *all* files before checking alreadyDeployed or starting any write.
  // A malicious extra SERVER_JS cannot ride along with a pinned apps_script.gs.
  if (!dryRun) assertGasProjectFileSet(currentContent.files, target.name, deployedContent.files);
  const releaseState=inspectGasReleaseState({headSource:target.source,publishedSource:deployedTarget.source});
  console.log(JSON.stringify(releaseState));
  if(!dryRun && (!releaseState.head.approved || !releaseState.published.approved))throw Error('GAS_RELEASE_STATE_UNAPPROVED');
  if(process.env.GAS_DEPLOY_DIAGNOSTIC_ONLY==='true')return releaseState;
  const alreadyDeployed = sameSource(deployedTarget.source, source) && sameSource(target.source, source);

  console.log(`GAS 자동배포 사전확인 · version=${expectedVersion} · file=${target.name} · currentDeploymentVersion=${currentVersionNumber} · dryRun=${dryRun}`);
  if (alreadyDeployed) {
    const webAppCheck = await verifyWebApp(webAppUrl, env('GAS_ACCESS_TOKEN', { required: false }), expectedVersion);
    const automation=await runBackfillStatus({url:webAppUrl,token:env('GAS_ACCESS_TOKEN')});
    if(automation.gasVersion!==expectedVersion)throw Error('GAS_AUTOMATION_VERSION_MISMATCH');
    console.log(`배포 생략 · 현재 웹앱 deployment가 이미 GAS v${expectedVersion} 소스와 일치하며 운영 endpoint 검증도 통과했습니다.`);
    return { deployed: false, alreadyDeployed: true, version: expectedVersion, deploymentVersion: currentVersionNumber, webAppCheck };
  }
  if (dryRun) {
    console.log('dry-run 완료 · 실제 프로젝트/버전/deployment는 변경하지 않았습니다.');
    return { deployed: false, dryRun: true, version: expectedVersion, deploymentVersion: currentVersionNumber };
  }

  const candidateFiles=buildUpdatedFiles(currentContent.files,target.name,source);
  let newVersionNumber=0,mutationStarted=false,stage='CONTENT_WRITE';
  try {
  await checkCurrentMain();
  mutationStarted=true;
  if (!sameSource(target.source, source)) {
    const files = buildUpdatedFiles(currentContent.files, target.name, source);
    await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content`, {
      method: 'PUT',
      token: accessToken,
      body: { files },
    });
    console.log(`HEAD 코드 갱신 완료 · ${target.name}`);
  } else {
    console.log('Apps Script HEAD는 이미 저장소 소스와 일치 · updateContent 생략');
  }

  stage='VERSION_CREATE';
  const version = await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/versions`, {
    method: 'POST',
    token: accessToken,
    body: { description: `GitHub ${sha} · GAS v${expectedVersion}` },
  });
  newVersionNumber = Number(version.versionNumber || 0);
  if (!newVersionNumber) throw new Error('새 Apps Script versionNumber를 확인하지 못했습니다.');

  // Never publish a version we did not inspect. Another GAS editor may
  // alter HEAD between our content GET/PUT and versions POST.
  stage='VERSION_READBACK';
  const createdVersionContent = await requestJson(
    `${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${newVersionNumber}`,
    { token: accessToken },
  );
  assertGasCreatedVersionReady(createdVersionContent.files, target.name, source, deployedContent.files);
  await checkCurrentMain();

  stage='DEPLOYMENT_WRITE';
  await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, {
    method: 'PUT',
    token: accessToken,
    body: {
      deploymentConfig: {
        scriptId,
        versionNumber: newVersionNumber,
        manifestFileName,
        description: `GitHub ${sha} · GAS v${expectedVersion}`,
      },
    },
  });

  stage='DEPLOYMENT_READBACK';
  await verifyDeploymentVersionWithRetry({
    readDeployment: () => requestJson(
      `${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
      { token: accessToken }),
    expectedVersion: newVersionNumber,
  });

  stage='WEBAPP_VERIFY';
  const webAppCheck = await verifyWebApp(webAppUrl, env('GAS_ACCESS_TOKEN', { required: false }), expectedVersion);
  stage='AUTOMATION_VERIFY';
  const automation=await runBackfillStatus({url:webAppUrl,token:env('GAS_ACCESS_TOKEN')});
  if(automation.gasVersion!==expectedVersion)throw Error('GAS_AUTOMATION_VERSION_MISMATCH');
  console.log(`GAS 자동배포 완료 · GAS v${expectedVersion} · Apps Script version=${newVersionNumber} · webApp=verified`);
  return { deployed: true, version: expectedVersion, deploymentVersion: newVersionNumber, webAppCheck };
  } catch(error) {
    console.log(JSON.stringify(summarizeGasReleaseFailure(error,stage)));
    if(!mutationStarted)throw error;
    try{
      await rollbackGasCode({beforeFiles:currentContent.files,candidateFiles,beforeDeployment:deployment,
        newVersion:newVersionNumber,
        readFiles:async()=> (await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content`,{token:accessToken})).files,
        writeFiles:files=>requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content`,{method:'PUT',token:accessToken,body:{files}}),
        readDeployment:()=>requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,{token:accessToken}),
        writeDeployment:deploymentConfig=>requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,{method:'PUT',token:accessToken,body:{deploymentConfig}})});
    }catch{throw Error('GAS_RELEASE_FAILED_ROLLBACK_UNVERIFIED');}
    throw Error('GAS_RELEASE_FAILED_ROLLBACK_VERIFIED');
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  deploy().catch(error => {
    console.error(`❌ GAS 자동배포 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
