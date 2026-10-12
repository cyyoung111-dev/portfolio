import fs from 'node:fs';
import { createHash } from 'node:crypto';

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
// The pinned Git blob ID below is the exact GAS file content reviewed on
// PR #481 (not a commit ID). When approving a new GAS source/version, update
// this manifest with the reviewed full-file blob SHA in the same reviewed PR.
// Unknown future versions fail closed rather than bypassing this contract.
const REVIEWED_GAS_SOURCE_BLOBS = Object.freeze({
  '9.193': '811ef56ede77cd040819941e73e4729826de935b',
  '9.194': '8082cf7b1f988b008799f8be1439cf4d54a3b51e',
  '9.195': '3ec29f63058b7f12eacb2de32303e65c2584b4ac',
  '9.196': '820e28103cf5b871dcccf4d03f5ab768bec6dcda',
  '9.197': '0d7eec10b1e1ff848b302e84db908196f4ef62eb',
  '9.199': '1de2d4e5e5379052534d854e37ce9cc2f3c421c4',
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
  if (actual !== reviewed) {
    throw new Error(`GAS_RELEASE_SOURCE_NOT_APPROVED: version=${version} actualBlob=${actual} reviewedBlob=${reviewed}`);
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
  const response = await fetch(url, { method, headers, body: payload, redirect: 'follow' });
  const responseText = await response.text();
  let parsed = null;
  try { parsed = responseText ? JSON.parse(responseText) : {}; }
  catch { parsed = null; }
  if (!response.ok) {
    const detail = parsed?.error?.message || parsed?.message || responseText.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`${method} ${new URL(url).pathname} 실패: HTTP ${response.status} · ${detail}`);
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
      });
      const responseText = await response.text();
      if (response.ok) {
        const data = JSON.parse(responseText);
        if (String(data?.gasVersion || '') === expectedVersion) {
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
  const alreadyDeployed = sameSource(deployedTarget.source, source);

  console.log(`GAS 자동배포 사전확인 · version=${expectedVersion} · file=${target.name} · currentDeploymentVersion=${currentVersionNumber} · dryRun=${dryRun}`);
  if (alreadyDeployed) {
    const webAppCheck = await verifyWebApp(webAppUrl, env('GAS_ACCESS_TOKEN', { required: false }), expectedVersion);
    console.log(`배포 생략 · 현재 웹앱 deployment가 이미 GAS v${expectedVersion} 소스와 일치하며 운영 endpoint 검증도 통과했습니다.`);
    return { deployed: false, alreadyDeployed: true, version: expectedVersion, deploymentVersion: currentVersionNumber, webAppCheck };
  }
  if (dryRun) {
    console.log('dry-run 완료 · 실제 프로젝트/버전/deployment는 변경하지 않았습니다.');
    return { deployed: false, dryRun: true, version: expectedVersion, deploymentVersion: currentVersionNumber };
  }

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

  const version = await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/versions`, {
    method: 'POST',
    token: accessToken,
    body: { description: `GitHub ${sha} · GAS v${expectedVersion}` },
  });
  const newVersionNumber = Number(version.versionNumber || 0);
  if (!newVersionNumber) throw new Error('새 Apps Script versionNumber를 확인하지 못했습니다.');

  // Never publish a version we did not inspect. Another GAS editor may
  // alter HEAD between our content GET/PUT and versions POST.
  const createdVersionContent = await requestJson(
    `${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/content?versionNumber=${newVersionNumber}`,
    { token: accessToken },
  );
  assertGasCreatedVersionReady(createdVersionContent.files, target.name, source, deployedContent.files);

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

  const verifiedDeployment = await requestJson(`${SCRIPT_API}/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`, { token: accessToken });
  if (Number(verifiedDeployment?.deploymentConfig?.versionNumber || 0) !== newVersionNumber) {
    throw new Error(`deployment version 검증 실패: expected=${newVersionNumber}`);
  }

  const webAppCheck = await verifyWebApp(webAppUrl, env('GAS_ACCESS_TOKEN', { required: false }), expectedVersion);
  console.log(`GAS 자동배포 완료 · GAS v${expectedVersion} · Apps Script version=${newVersionNumber} · webApp=verified`);
  return { deployed: true, version: expectedVersion, deploymentVersion: newVersionNumber, webAppCheck };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  deploy().catch(error => {
    console.error(`❌ GAS 자동배포 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
