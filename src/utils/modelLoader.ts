import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

export function normalizeModel(object: THREE.Object3D): THREE.Group {
  const container = new THREE.Group();
  container.add(object);

  // Compute bounding box
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // Center object
  object.position.x -= center.x;
  object.position.y -= center.y;
  object.position.z -= center.z;

  // Scale object to normalized diameter ~ 4.0
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 3.6 / maxDim;
    container.scale.setScalar(scale);
  }

  // Ensure shadows and materials are properly configured for pure white background
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Enhance material if standard/physical
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.envMapIntensity = 1.2;
            mat.needsUpdate = true;
          }
        });
      } else if (mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.envMapIntensity = 1.2;
        mesh.material.needsUpdate = true;
      }
    }
  });

  return container;
}

export async function loadModelFromFile(file: File): Promise<{ model: THREE.Group; name: string; format: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const arrayBuffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    if (extension === 'glb' || extension === 'gltf') {
      const loader = new GLTFLoader();
      loader.parse(
        arrayBuffer,
        '',
        (gltf) => {
          const normalized = normalizeModel(gltf.scene);
          resolve({ model: normalized, name: file.name, format: extension });
        },
        (error) => reject(error)
      );
    } else if (extension === 'obj') {
      const text = new TextDecoder().decode(arrayBuffer);
      const loader = new OBJLoader();
      try {
        const obj = loader.parse(text);
        const normalized = normalizeModel(obj);
        resolve({ model: normalized, name: file.name, format: 'obj' });
      } catch (err) {
        reject(err);
      }
    } else if (extension === 'stl') {
      const loader = new STLLoader();
      try {
        const geometry = loader.parse(arrayBuffer);
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: 0x4a729e,
          metalness: 0.6,
          roughness: 0.25,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const normalized = normalizeModel(mesh);
        resolve({ model: normalized, name: file.name, format: 'stl' });
      } catch (err) {
        reject(err);
      }
    } else if (extension === 'ply') {
      const loader = new PLYLoader();
      try {
        const geometry = loader.parse(arrayBuffer);
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: 0x5a6d85,
          metalness: 0.5,
          roughness: 0.3,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const normalized = normalizeModel(mesh);
        resolve({ model: normalized, name: file.name, format: 'ply' });
      } catch (err) {
        reject(err);
      }
    } else {
      reject(new Error(`Unsupported format: .${extension}`));
    }
  });
}

/**
 * Creates high-fidelity procedural 3-12 part models according to Three.js guidelines:
 * PBR materials, multi-part hierarchy, pure zero-404 generation.
 */
export function createProceduralDrone(): THREE.Group {
  const root = new THREE.Group();

  // Materials
  const titaniumHullMat = new THREE.MeshPhysicalMaterial({
    color: 0x22262d,
    metalness: 0.85,
    roughness: 0.2,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe6e9ef,
    metalness: 0.95,
    roughness: 0.1,
  });

  const copperAccentMat = new THREE.MeshStandardMaterial({
    color: 0xc97a3e,
    metalness: 0.9,
    roughness: 0.25,
  });

  const cyanGlowMat = new THREE.MeshStandardMaterial({
    color: 0x00d2ff,
    emissive: 0x0099cc,
    emissiveIntensity: 0.8,
    roughness: 0.2,
    metalness: 0.4,
  });

  const glassVisorMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a2634,
    metalness: 0.1,
    roughness: 0.05,
    transmission: 0.9,
    ior: 1.52,
    thickness: 0.8,
  });

  // 1. Primary Silhouette: Central Aerodynamic Cockpit & Fuselage
  const hullGeo = new THREE.CylinderGeometry(0.35, 0.7, 1.8, 32);
  hullGeo.rotateZ(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, titaniumHullMat);
  hull.scale.set(1.4, 0.75, 0.9);
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);

  // Visor canopy
  const visorGeo = new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI, 0, Math.PI / 2);
  const visor = new THREE.Mesh(visorGeo, glassVisorMat);
  visor.position.set(0.4, 0.25, 0);
  visor.scale.set(1.2, 0.5, 0.7);
  visor.rotation.z = -Math.PI / 2;
  visor.castShadow = true;
  root.add(visor);

  // 2. Secondary read: 4 Swept Wing Booms and Dual Turbines
  const armAngles = [
    Math.PI / 4,
    (3 * Math.PI) / 4,
    (5 * Math.PI) / 4,
    (7 * Math.PI) / 4,
  ];

  armAngles.forEach((angle) => {
    const armGroup = new THREE.Group();
    armGroup.rotation.y = angle;

    // Carbon wing strut
    const strutGeo = new THREE.BoxGeometry(1.6, 0.08, 0.24);
    const strut = new THREE.Mesh(strutGeo, titaniumHullMat);
    strut.position.x = 0.9;
    strut.castShadow = true;
    strut.receiveShadow = true;
    armGroup.add(strut);

    // Motor Pod Housing
    const podGeo = new THREE.CylinderGeometry(0.42, 0.38, 0.5, 32);
    const pod = new THREE.Mesh(podGeo, chromeMat);
    pod.position.set(1.7, 0, 0);
    pod.castShadow = true;
    armGroup.add(pod);

    // Cyan glowing ring inside turbine
    const ringGeo = new THREE.TorusGeometry(0.36, 0.04, 16, 32);
    ringGeo.rotateX(Math.PI / 2);
    const glowRing = new THREE.Mesh(ringGeo, cyanGlowMat);
    glowRing.position.set(1.7, 0.1, 0);
    armGroup.add(glowRing);

    // Rotor blades
    const rotorHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.15, 16), copperAccentMat);
    rotorHub.position.set(1.7, 0.28, 0);
    const blade1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.12), titaniumHullMat);
    rotorHub.add(blade1);
    const blade2 = blade1.clone();
    blade2.rotation.y = Math.PI / 2;
    rotorHub.add(blade2);
    rotorHub.castShadow = true;
    armGroup.add(rotorHub);

    // Foot landing pad
    const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 12);
    const leg = new THREE.Mesh(legGeo, copperAccentMat);
    leg.position.set(1.7, -0.4, 0);
    leg.castShadow = true;
    armGroup.add(leg);

    root.add(armGroup);
  });

  // Central Sensor Array / Core
  const coreSensor = new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 32), cyanGlowMat);
  coreSensor.position.set(0, -0.3, 0);
  root.add(coreSensor);

  return normalizeModel(root);
}

export function createProceduralRoboticArm(): THREE.Group {
  const root = new THREE.Group();

  const orangeMetal = new THREE.MeshStandardMaterial({
    color: 0xd95328,
    metalness: 0.8,
    roughness: 0.25,
  });

  const darkGunmetal = new THREE.MeshStandardMaterial({
    color: 0x24282e,
    metalness: 0.9,
    roughness: 0.35,
  });

  const goldAccent = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.95,
    roughness: 0.15,
  });

  // Base turntable
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.4, 48), darkGunmetal);
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 48), orangeMetal);
  turntable.position.y = 0.35;
  turntable.castShadow = true;
  root.add(turntable);

  // Shoulder Joint
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), goldAccent);
  shoulder.position.y = 0.75;
  shoulder.castShadow = true;
  root.add(shoulder);

  // Arm 1
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 1.8, 32), orangeMetal);
  arm1.position.set(0.3, 1.6, 0);
  arm1.rotation.z = -Math.PI / 10;
  arm1.castShadow = true;
  root.add(arm1);

  // Elbow Joint
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.6, 32), darkGunmetal);
  elbow.rotation.x = Math.PI / 2;
  elbow.position.set(0.6, 2.45, 0);
  elbow.castShadow = true;
  root.add(elbow);

  // Arm 2 (Forearm)
  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.6, 32), orangeMetal);
  arm2.position.set(1.2, 3.1, 0);
  arm2.rotation.z = -Math.PI / 4;
  arm2.castShadow = true;
  root.add(arm2);

  // Wrist & Gripper Claw
  const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 24), goldAccent);
  wrist.position.set(1.8, 3.7, 0);
  wrist.castShadow = true;
  root.add(wrist);

  const clawBase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), darkGunmetal);
  clawBase.position.set(2.0, 3.9, 0);
  root.add(clawBase);

  const claw1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.1), orangeMetal);
  claw1.position.set(2.1, 4.2, 0.12);
  claw1.rotation.x = -Math.PI / 12;
  root.add(claw1);

  const claw2 = claw1.clone();
  claw2.position.set(2.1, 4.2, -0.12);
  claw2.rotation.x = Math.PI / 12;
  root.add(claw2);

  return normalizeModel(root);
}

export function createProceduralCrystalArtifact(): THREE.Group {
  const root = new THREE.Group();

  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x3d70b2,
    metalness: 0.1,
    roughness: 0.05,
    transmission: 0.85,
    ior: 1.75,
    thickness: 2.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });

  const goldFrameMat = new THREE.MeshStandardMaterial({
    color: 0xecb142,
    metalness: 0.95,
    roughness: 0.15,
  });

  // Octahedron crystal core
  const crystalGeo = new THREE.OctahedronGeometry(1.6, 1);
  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.castShadow = true;
  root.add(crystal);

  // Concentric Orbiting Gold Rings
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.06, 16, 64), goldFrameMat);
  ring1.rotation.x = Math.PI / 3;
  root.add(ring1);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.05, 16, 64), goldFrameMat);
  ring2.rotation.y = Math.PI / 4;
  root.add(ring2);

  const ring3 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.04, 16, 64), goldFrameMat);
  ring3.rotation.z = Math.PI / 6;
  root.add(ring3);

  return normalizeModel(root);
}
