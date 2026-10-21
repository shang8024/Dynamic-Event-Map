"""Exercise the production image worker in a disposable, resource-limited container."""
import json
import subprocess
import time
import uuid

name = 'eventmap-image-test-' + uuid.uuid4().hex[:12]
image = 'eventmap-api-check:local'


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=60).strip()


try:
    docker('run', '-d', '--name', name, '--network', 'none', '--read-only',
           '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
           '--memory', '256m', '--cpus', '0.5', '--user', '1000:1000',
           '-e', 'NODE_ENV=production', '-e', 'NODE_OPTIONS=--max-old-space-size=96',
           '-e', 'IMAGE_PROXY_WORKER=true', image, 'node', 'workers/imageProxy.js')
    config = json.loads(docker('inspect', name))[0]
    assert config['HostConfig']['ReadonlyRootfs']
    assert config['HostConfig']['CapDrop'] == ['ALL']
    assert config['HostConfig']['Memory'] == 256 * 1024 * 1024
    assert config['HostConfig']['NanoCpus'] == 500_000_000
    assert config['Config']['User'] == '1000:1000'
    assert not config['Mounts']
    for attempt in range(15):
        try:
            result = docker('exec', name, 'node', '-e',
                "fetch('http://127.0.0.1:5100/healthz').then(r=>r.json()).then(v=>{if(v.status!=='ok')process.exit(1)})")
            break
        except subprocess.CalledProcessError:
            if attempt == 14:
                raise
            time.sleep(0.2)
    result = json.loads(docker('exec', name, 'node', '-e', """
const fs=require('fs');
if(process.getuid()!==1000 || fs.existsSync('/run/secrets') || fs.existsSync('/var/run/docker.sock'))process.exit(1);
if(Object.keys(process.env).some(key=>/DB_|PGPASSWORD|REDIS_|AWS_|SECRET|FIREBASE/.test(key)))process.exit(1);
if(!/^CapEff:\\s+0000000000000000$/m.test(fs.readFileSync('/proc/self/status','utf8')))process.exit(1);
try {fs.writeFileSync('/app/write-probe','bad');process.exit(1)}catch(error){if(error.code!=='EROFS')throw error}
(async()=>{
  const response=await fetch('http://127.0.0.1:5100/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://169.254.169.254/latest/meta-data/',size:'thumb'})});
  const rejection=await response.json();
  if(response.status!==422 || rejection.code!=='IMAGE_HOST_NOT_ALLOWED')process.exit(1);
  const sharp=require('sharp'),{sanitizeImage}=require('./services/eventImages');
  const input=await sharp({create:{width:200,height:100,channels:3,background:'#f80'}}).jpeg().withMetadata().toBuffer();
  const output=await sanitizeImage(input,'thumb'),info=await sharp(output).metadata();
  if(info.format!=='webp' || info.width!==128 || info.exif)process.exit(1);
  console.log(JSON.stringify({blocked:rejection.code,format:info.format,metadataRemoved:!info.exif}));
})().catch(()=>process.exit(1));
"""))
    print('PASS isolated image worker:', result)
finally:
    subprocess.run(['docker', 'rm', '-f', name], check=False, capture_output=True, timeout=30)
