import * as THREE from 'three';
const wrap=document.getElementById('wrap'),canvas=document.getElementById('rcanvas'),loading=document.getElementById('loading');

// ---- WebGL capability check: poster fallback if unsupported ----
function webglOK(){try{const c=document.createElement('canvas');return !!(window.WebGLRenderingContext&&(c.getContext('webgl')||c.getContext('experimental-webgl')));}catch(e){return false;}}
if(!wrap||!webglOK()){
  if(loading){loading.textContent='';loading.classList.add('hidden');}
  throw new Error('WebGL unavailable — poster fallback');
}

const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0x0a1726,100,260);
const camera=new THREE.PerspectiveCamera(42,wrap.clientWidth/wrap.clientHeight,0.1,600);
let camR=120,camTheta=0.6,camPhi=0.92;
function updateCam(){camera.position.set(camR*Math.sin(camPhi)*Math.cos(camTheta),camR*Math.cos(camPhi),camR*Math.sin(camPhi)*Math.sin(camTheta));camera.lookAt(0,-2,0);}
updateCam();
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setSize(wrap.clientWidth,wrap.clientHeight);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;

scene.add(new THREE.AmbientLight(0x4a5a72,0.7));
const key=new THREE.DirectionalLight(0xfff0d8,1.5);key.position.set(40,70,30);key.castShadow=true;
key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-80;key.shadow.camera.right=80;key.shadow.camera.top=80;key.shadow.camera.bottom=-80;scene.add(key);
const rim=new THREE.DirectionalLight(0xC9A84C,0.8);rim.position.set(-50,20,-40);scene.add(rim);
const fill=new THREE.PointLight(0x5d9bd4,0.5,200);fill.position.set(0,40,60);scene.add(fill);

// RESERVOIR
const NX=20,NY=16,NLAYERS=6,CW=4,CD=4,CH=2.4;
const reservoir=new THREE.Group();
function satColor(s){const c=new THREE.Color();if(s>0.55){const t=(s-0.55)/0.45;c.lerpColors(new THREE.Color(0xC0392B),new THREE.Color(0xC9A84C),t);}else{const t=s/0.55;c.lerpColors(new THREE.Color(0x0B1F3A),new THREE.Color(0xC0392B),t);}return c;}
function domeZ(i,j){const dx=(i-NX/2)/(NX/2),dy=(j-NY/2)/(NY/2);return (1-Math.sqrt(dx*dx*0.6+dy*dy))*10;}
const box=new THREE.BoxGeometry(CW*0.96,CH*0.9,CD*0.96);
for(let L=0;L<NLAYERS;L++){
  const inst=new THREE.InstancedMesh(box,new THREE.MeshStandardMaterial({roughness:0.55,metalness:0.15}),NX*NY);
  inst.castShadow=true;inst.receiveShadow=true;const m=new THREE.Matrix4();let idx=0;
  for(let j=0;j<NY;j++)for(let i=0;i<NX;i++){
    const dx=(i-NX/2)/(NX/2),dy=(j-NY/2)/(NY/2);
    const structural=1-Math.sqrt(dx*dx*0.6+dy*dy);
    const depthF=1-(L/(NLAYERS-1))*0.8;
    let s=Math.max(0,Math.min(1,structural*depthF+(Math.random()-0.5)*0.14));
    const faulted=i>=NX*0.6?-3:0;
    m.makeTranslation((i-NX/2)*CW,domeZ(i,j)-L*CH+faulted,(j-NY/2)*CD);
    inst.setMatrixAt(idx,m);inst.setColorAt(idx,satColor(s));idx++;
  }
  inst.instanceMatrix.needsUpdate=true;reservoir.add(inst);
}
reservoir.position.y=-6;scene.add(reservoir);

// WELLS + pump jacks. Record wellhead positions for flowlines.
const surfaceY=18;
const wellMat=new THREE.MeshStandardMaterial({color:0xdfe4ea,roughness:0.3,metalness:0.8});
const wells=[{i:9,j:8},{i:7,j:6},{i:12,j:9}];
const facPos=new THREE.Vector3(34,surfaceY,16);
wells.forEach(w=>{
  const x=(w.i-NX/2)*CW,z=(w.j-NY/2)*CD;
  const topY=surfaceY,botY=domeZ(w.i,w.j)-6,h=topY-botY;
  const well=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,h,12),wellMat);
  well.position.set(x,(topY+botY)/2,z);well.castShadow=true;scene.add(well);
  const base=new THREE.Mesh(new THREE.BoxGeometry(3,1,2),new THREE.MeshStandardMaterial({color:0x33405a,roughness:0.7}));
  base.position.set(x,surfaceY+0.5,z);base.castShadow=true;scene.add(base);
  const post=new THREE.Mesh(new THREE.BoxGeometry(0.4,4,0.4),new THREE.MeshStandardMaterial({color:0x556173}));
  post.position.set(x,surfaceY+3,z);scene.add(post);
  const beam=new THREE.Mesh(new THREE.BoxGeometry(6,0.5,0.5),new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:0.5,metalness:0.4}));
  beam.position.set(x,surfaceY+5,z);beam.castShadow=true;beam.userData.bob=Math.random()*6.28;scene.add(beam);
  w.beam=beam;w.head=new THREE.Vector3(x,surfaceY+1,z);
});

// FACILITY
const facMat=new THREE.MeshStandardMaterial({color:0x3a4a63,roughness:0.5,metalness:0.5});
const facGroup=new THREE.Group();facGroup.position.copy(facPos);
const tank1=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.5,7,16),facMat);tank1.position.y=3.5;tank1.castShadow=true;facGroup.add(tank1);
const tank2=new THREE.Mesh(new THREE.CylinderGeometry(1.8,1.8,5,16),facMat);tank2.position.set(6,2.5,2);tank2.castShadow=true;facGroup.add(tank2);
const tower=new THREE.Mesh(new THREE.BoxGeometry(2,9,2),facMat);tower.position.set(-5,4.5,1);tower.castShadow=true;facGroup.add(tower);
const flareStack=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,8,8),facMat);flareStack.position.set(10,4,-2);facGroup.add(flareStack);
const flare=new THREE.Mesh(new THREE.ConeGeometry(0.8,2,8),new THREE.MeshStandardMaterial({color:0xE8C96A,emissive:0xC0392B,emissiveIntensity:1.5}));
flare.position.set(10,9,-2);facGroup.add(flare);facGroup.userData.flare=flare;
scene.add(facGroup);

// SEA + TANKER (fixed: lower, darker, non-reflective enough to not read as black slab; positioned away)
const seaMat=new THREE.MeshStandardMaterial({color:0x123048,roughness:0.4,metalness:0.2,transparent:true,opacity:0.7});
const sea=new THREE.Mesh(new THREE.PlaneGeometry(60,44),seaMat);
sea.rotation.x=-Math.PI/2;sea.position.set(60,surfaceY-1.2,-34);sea.receiveShadow=true;scene.add(sea);
const tanker=new THREE.Group();tanker.position.set(60,surfaceY,-34);
const hull=new THREE.Mesh(new THREE.BoxGeometry(10,1.5,4),facMat);hull.position.y=0.75;hull.castShadow=true;tanker.add(hull);
const house=new THREE.Mesh(new THREE.BoxGeometry(2,2,3),facMat);house.position.set(3.5,2,0);tanker.add(house);
scene.add(tanker);
const exportPt=new THREE.Vector3(60,surfaceY+1,-34);

// ---------- FLOWLINES + FLOWING OIL ----------
// Build a tube from A to B (with a mid surface routing), plus animated dashed oil overlay.
const flowSegments=[];
function makeFlow(a,b){
  const mid=new THREE.Vector3((a.x+b.x)/2,surfaceY+1,(a.z+b.z)/2);
  const curve=new THREE.CatmullRomCurve3([a.clone().setY(surfaceY+1),mid,b.clone().setY(surfaceY+1)]);
  const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,24,0.45,8,false),
    new THREE.MeshStandardMaterial({color:0x2a3a52,roughness:0.6,metalness:0.4}));
  tube.castShadow=true;scene.add(tube);
  // flowing oil: small emissive spheres travelling the curve
  const N=5,dots=[];
  for(let k=0;k<N;k++){
    const d=new THREE.Mesh(new THREE.SphereGeometry(0.5,8,8),
      new THREE.MeshStandardMaterial({color:0xC9A84C,emissive:0x8a6a1e,emissiveIntensity:1.2,roughness:0.2}));
    scene.add(d);dots.push(d);
  }
  flowSegments.push({curve,dots,N});
}
wells.forEach(w=>makeFlow(w.head,facPos));          // wells -> facility
makeFlow(facPos,exportPt);                            // facility -> export tanker

// INTERACTION
let dragging=false,lastX=0,lastY=0,idle=true,idleTimer;
wrap.addEventListener('pointerdown',e=>{dragging=true;idle=false;lastX=e.clientX;lastY=e.clientY;clearTimeout(idleTimer);wrap.setPointerCapture(e.pointerId);});
wrap.addEventListener('pointermove',e=>{if(!dragging)return;camTheta-=(e.clientX-lastX)*0.006;camPhi=Math.max(0.3,Math.min(1.4,camPhi+(e.clientY-lastY)*0.005));lastX=e.clientX;lastY=e.clientY;updateCam();});
wrap.addEventListener('pointerup',()=>{dragging=false;idleTimer=setTimeout(()=>idle=true,3500);});
wrap.addEventListener('wheel',e=>{e.preventDefault();camR=Math.max(70,Math.min(190,camR+e.deltaY*0.05));updateCam();},{passive:false});

// LOOP signal animation (SVG) — node pulse as signal passes
const signal=document.getElementById('signal');
const nodes=['n-res','n-well','n-fac','n-exp'].map(id=>document.getElementById(id));
let loopT=0;
function loopTick(){
  loopT=(loopT+0.0022)%1;
  // dashoffset moves the 40-len arc around 452 circumference
  signal.style.strokeDashoffset = (-452*loopT).toFixed(1);
  // pulse node nearest current position (0=top,.25=right,.5=bottom,.75=left)
  nodes.forEach((n,k)=>{
    const np=k*0.25;
    let dist=Math.abs(((loopT - np)+1)%1); dist=Math.min(dist,1-dist);
    const glow=Math.max(0,1-dist*8);
    n.querySelector('circle').setAttribute('stroke-width',(1.5+glow*2.5).toFixed(2));
    n.querySelector('circle').setAttribute('stroke',`rgba(201,168,76,${0.5+glow*0.5})`);
  });
}

const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let t=0, heroVisible=true;
// pause GPU loop when hero scrolls out of view
if('IntersectionObserver' in window){
  new IntersectionObserver(es=>{heroVisible=es[0].isIntersecting;}, {threshold:0.05}).observe(wrap);
}
function animate(){
  requestAnimationFrame(animate);
  if(!heroVisible){return;}
  t+=0.016;
  if(idle&&!dragging&&!reduce){camTheta+=0.0012;updateCam();}
  wells.forEach(w=>{w.beam.rotation.z=Math.sin(t*1.5+w.beam.userData.bob)*0.18;});
  if(facGroup.userData.flare){const f=facGroup.userData.flare;f.scale.y=1+Math.sin(t*8)*0.2;f.material.emissiveIntensity=1.3+Math.sin(t*8)*0.4;}
  tanker.rotation.z=Math.sin(t*0.8)*0.04;
  // animate flowing oil dots along each flowline
  flowSegments.forEach((seg,si)=>{
    seg.dots.forEach((d,k)=>{
      let u=((t*0.18)+(k/seg.N)+si*0.05)%1;
      const p=seg.curve.getPoint(u);d.position.copy(p);
    });
  });
  if(!reduce)loopTick();
  renderer.render(scene,camera);
}
loading.classList.add('hidden');animate();
window.addEventListener('resize',()=>{camera.aspect=wrap.clientWidth/wrap.clientHeight;camera.updateProjectionMatrix();renderer.setSize(wrap.clientWidth,wrap.clientHeight);});