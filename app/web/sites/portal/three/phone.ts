import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import phoneUrl from "../assets/models/iphone_15_pro_max.glb?url";
import { disposeTree } from "./stage";

/** Node names belong to the pinned asset, documented in assets/models/README.md. */
const PARTS = {
  screen: "xXDHkMplTIDAXLN",
  glass: "vELORlCJixqPHsZ",
  frame: "GuYJryuYunhpphO",
} as const;

export async function loadPhone(width: number) {
  const { scene: model } = await new GLTFLoader().loadAsync(phoneUrl);
  const screenSource = model.getObjectByName(PARTS.screen);
  const glass = model.getObjectByName(PARTS.glass);
  const frame = model.getObjectByName(PARTS.frame);
  if (!(screenSource instanceof THREE.Mesh) || !(glass instanceof THREE.Mesh) || !(frame instanceof THREE.Mesh)) {
    disposeTree(model);
    throw new Error("The pinned iPhone model is missing its screen, glass or frame");
  }

  const phone = new THREE.Group();
  phone.name = "desk-phone";
  phone.add(model);
  // The source display faces -Z; desk screens face +Z.
  model.rotation.y = Math.PI;
  const bounds = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(width / bounds.getSize(new THREE.Vector3()).x);
  bounds.setFromObject(model);
  model.position.sub(bounds.getCenter(new THREE.Vector3()));
  phone.updateMatrixWorld(true);
  bounds.setFromObject(phone);

  // Reuse the authored display outline, including its rounded corners and island cutout.
  const source = screenSource.geometry as THREE.BufferGeometry;
  const vertices = source.getAttribute("position");
  const positions = new Float32Array(vertices.count * 3);
  const point = new THREE.Vector3();
  for (let i = 0; i < vertices.count; i++) {
    point.fromBufferAttribute(vertices, i).applyMatrix4(screenSource.matrixWorld);
    point.toArray(positions, i * 3);
  }
  const display = new THREE.BufferGeometry();
  display.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (source.index) display.setIndex(source.index.clone());
  display.computeBoundingBox();
  const center = display.boundingBox!.getCenter(new THREE.Vector3());
  const size = display.boundingBox!.getSize(new THREE.Vector3());
  display.translate(-center.x, -center.y, -center.z);
  const uv = new Float32Array(vertices.count * 2);
  const local = display.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    uv[i * 2] = local.getX(i) / size.x + 0.5;
    uv[i * 2 + 1] = local.getY(i) / size.y + 0.5;
  }
  display.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  display.computeVertexNormals();
  display.computeBoundingBox();
  screenSource.visible = false;
  glass.castShadow = frame.castShadow = true;
  return { phone, bounds, display, center, size, pickParts: [glass, frame] };
}
