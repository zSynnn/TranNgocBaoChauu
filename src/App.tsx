import { Text } from "@react-three/drei";
import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { MathUtils } from "three";
import * as random from "maath/random";
import {
  GestureRecognizer,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

// --- 动态生成照片列表 (top.jpg + 1.jpg 到 31.jpg) ---
const TOTAL_NUMBERED_PHOTOS = 31;
// 修改：将 top.jpg 加入到数组开头
const bodyPhotoPaths = [
  "/photos/top.jpg",
  ...Array.from(
    { length: TOTAL_NUMBERED_PHOTOS },
    (_, i) => `/photos/${i + 1}.jpg`,
  ),
];

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: "#004225", // 纯正祖母绿
    gold: "#FFD700",
    silver: "#ECEFF1",
    red: "#D32F2F",
    green: "#2E7D32",
    white: "#FFFFFF", // 纯白色
    warmLight: "#FFD54F",
    lights: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"], // 彩灯
    // 拍立得边框颜色池 (复古柔和色系)
    borders: [
      "#FFFAF0",
      "#F0E68C",
      "#E6E6FA",
      "#FFB6C1",
      "#98FB98",
      "#87CEFA",
      "#FFDAB9",
    ],
    // 圣诞元素颜色
    giftColors: ["#D32F2F", "#FFD700", "#ff00bf", "#ffffff"],
    candyColors: ["#FF0000", "#FFFFFF"],
  },
  counts: {
    foliage: 15000,
    ornaments: 300, // 拍立得照片数量
    elements: 200, // 圣诞元素数量
    lights: 400, // 彩灯数量
  },
  tree: { height: 22, radius: 9 }, // 树体尺寸
  photos: {
    // top 属性不再需要，因为已经移入 body
    body: bodyPhotoPaths,
  },
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color("#ffffff"), uProgress: 0 },
  `uniform float uTime;
   uniform float uProgress;
   attribute vec3 aTargetPos;
   attribute float aRandom;
   varying vec2 vUv;
   varying float vMix;

   float cubicInOut(float t) {
     return t < 0.5
       ? 4.0 * t * t * t
       : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0;
   }

   void main() {
     vUv = uv;

     vec3 noise = vec3(
       sin(uTime * 1.5 + position.x),
       cos(uTime + position.y),
       sin(uTime * 1.5 + position.z)
     ) * 0.15;

     float t = cubicInOut(uProgress);
     vec3 finalPos = mix(position, aTargetPos + noise, t);

     vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
     gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
     gl_Position = projectionMatrix * mvPosition;

     vMix = t;
   }`,
  `uniform vec3 uColor;
   varying float vMix;

   void main() {
     float d = length(gl_PointCoord.xy - 0.5);
     if (d > 0.5) discard;

     // galaxy nebula colors
     vec3 c1 = vec3(0.3, 0.1, 1.0);   // tím
     vec3 c2 = vec3(1.0, 0.3, 0.6);   // hồng
     vec3 c3 = vec3(1.0, 0.8, 0.2);   // vàng
     vec3 c4 = vec3(0.2, 0.7, 1.0);   // xanh

     vec3 col = mix(c1, c2, vMix);
     col = mix(col, c3, pow(vMix, 2.0));
     col = mix(col, c4, smoothstep(0.0, 0.7, d));

     // core glow
     float glow = smoothstep(0.5, 0.0, d);
     col += vec3(1.0, 0.9, 0.6) * glow * 0.6;

     gl_FragColor = vec4(col, 1.0);
   }`,
);
extend({ FoliageMaterial });
// -- get Heart --
const getHeartPosition = () => {
  const t = Math.random() * Math.PI * 2;

  const x = 16 * Math.pow(Math.sin(t), 3);
  const y =
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t);

  const scale = 0.5;

  return [x * scale, y * scale, (Math.random() - 0.5) * 6];
};

// --- Helper: Galaxy Shape ---
const getTreePosition = () => {
  const radius = 20;
  const branches = 4;

  const r = Math.random() * radius;
  const branch =
    (Math.floor(Math.random() * branches) / branches) * Math.PI * 2;

  const spin = r * 0.8;

  let x = Math.cos(branch + spin) * r;
  let z = Math.sin(branch + spin) * r;
  let y = (Math.random() - 0.5) * 2;

  // nghiêng galaxy (tilt)
  const tilt = 0.5; // tăng giảm để nghiêng nhiều ít
  const newY = y * Math.cos(tilt) - z * Math.sin(tilt);
  const newZ = y * Math.sin(tilt) + z * Math.cos(tilt);

  return [x, newY, newZ];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3);
    const targetPositions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), {
      radius: 25,
    }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = spherePoints[i * 3];
      positions[i * 3 + 1] = spherePoints[i * 3 + 1];
      positions[i * 3 + 2] = spherePoints[i * 3 + 2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i * 3] = tx;
      targetPositions[i * 3 + 1] = ty;
      targetPositions[i * 3 + 2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === "FORMED" ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(
        materialRef.current.uProgress,
        targetProgress,
        0.5,
        delta,
      );
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute
          attach="attributes-aTargetPos"
          args={[targetPositions, 3]}
        />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
const PhotoOrnaments = ({
  state,
  showPhoto,
  selectedIndex,
}: {
  state: "CHAOS" | "FORMED";
  showPhoto: boolean;
  selectedIndex: number | null;
}) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const explode = 40;
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * explode;

      const chaosPos = new THREE.Vector3(
        Math.cos(angle) * dist,
        (Math.random() - 0.5) * 5,
        Math.sin(angle) * dist,
      );

      const h = CONFIG.tree.height;
      const y = Math.random() * h - h / 2;
      const rBase = CONFIG.tree.radius;
      const currentRadius = rBase * (1 - (y + h / 2) / h) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const [hx, hy, hz] = getHeartPosition();
      const targetPos = new THREE.Vector3(hx, hy, hz);

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor =
        CONFIG.colors.borders[
          Math.floor(Math.random() * CONFIG.colors.borders.length)
        ];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0,
      };
      const chaosRotation = new THREE.Euler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );

      return {
        chaosPos,
        targetPos,
        scale: baseScale,
        weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5,
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === "FORMED";
    // tìm ảnh gần camera nhất
    let nearest = 0;
    let minDist = Infinity;

    groupRef.current.children.forEach((group, i) => {
      const d = group.position.distanceTo(stateObj.camera.position);
      if (d < minDist) {
        minDist = d;
        nearest = i;
      }
    });

    // lưu index gần nhất vào window (Experience sẽ đọc)
    (window as any).nearestPhotoIndex = nearest;

    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(
        target,
        delta * (isFormed ? 0.8 * objData.weight : 0.5),
      );
      group.position.copy(objData.currentPos);

      if (selectedIndex === i) {
        const target = new THREE.Vector3(0, 0, 15);

        // chống rung iPhone style
        group.position.x = THREE.MathUtils.damp(
          group.position.x,
          target.x,
          14,
          delta,
        );
        group.position.y = THREE.MathUtils.damp(
          group.position.y,
          target.y,
          14,
          delta,
        );
        group.position.z = THREE.MathUtils.damp(
          group.position.z,
          target.z,
          14,
          delta,
        );

        group.scale.x = THREE.MathUtils.damp(group.scale.x, 6, 14, delta);
        group.scale.y = THREE.MathUtils.damp(group.scale.y, 6, 14, delta);
        group.scale.z = THREE.MathUtils.damp(group.scale.z, 6, 14, delta);

        (window as any).zoomTargetPos = group.position.clone();

        group.lookAt(stateObj.camera.position);
      } else {
        group.scale.lerp(
          new THREE.Vector3(objData.scale, objData.scale, objData.scale),
          delta * 4,
        );
      }

      // fade ảnh khi formed / chaos
      const targetOpacity = isFormed ? 0 : 1;

      group.traverse((child: any) => {
        if (child.material) {
          child.material.transparent = true;
          child.material.opacity = THREE.MathUtils.lerp(
            child.material.opacity ?? 0,
            targetOpacity,
            delta * 3,
          );
        }
      });

      if (isFormed) {
        const targetLookPos = new THREE.Vector3(
          group.position.x * 2,
          group.position.y + 0.5,
          group.position.z * 2,
        );
        group.lookAt(targetLookPos);

        const wobbleX =
          Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
        const wobbleZ =
          Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) *
          0.05;
        group.rotation.x += wobbleX;
        group.rotation.z += wobbleZ;
      } else {
        group.rotation.x += delta * objData.rotationSpeed.x;
        group.rotation.y += delta * objData.rotationSpeed.y;
        group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group
          key={i}
          scale={[obj.scale, obj.scale, obj.scale]}
          rotation={state === "CHAOS" ? obj.chaosRotation : [0, 0, 0]}
        >
          {/* 正面 */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5}
                metalness={0}
                emissive={CONFIG.colors.white}
                emissiveMap={textures[obj.textureIndex]}
                emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial
                color={"#f4f1ea"} // cinematic off-white
                roughness={0.85}
                metalness={0}
                emissive={"#ffffff"} // subtle film warmth
                emissiveIntensity={0.08}
              />
            </mesh>
          </group>
          {/* 背面 */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.65}
                metalness={0}
                emissive={"#ffffff"}
                emissiveIntensity={0.05}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial
                color={obj.borderColor}
                roughness={0.65}
                metalness={0}
                side={THREE.FrontSide}
              />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(
    () => new THREE.SphereGeometry(0.5, 16, 16),
    [],
  );
  const caneGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8),
    [],
  );

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3(
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60,
      );
      const h = CONFIG.tree.height;
      const y = Math.random() * h - h / 2;
      const rBase = CONFIG.tree.radius;
      const currentRadius = rBase * (1 - (y + h / 2) / h) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const [hx, hy, hz] = getHeartPosition();
      const targetPos = new THREE.Vector3(hx, hy, hz);

      const type = Math.floor(Math.random() * 3);
      let color;
      let scale = 1;
      if (type === 0) {
        color =
          CONFIG.colors.giftColors[
            Math.floor(Math.random() * CONFIG.colors.giftColors.length)
          ];
        scale = 0.8 + Math.random() * 0.4;
      } else if (type === 1) {
        color =
          CONFIG.colors.giftColors[
            Math.floor(Math.random() * CONFIG.colors.giftColors.length)
          ];
        scale = 0.6 + Math.random() * 0.4;
      } else {
        color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white;
        scale = 0.7 + Math.random() * 0.3;
      }

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 2.0,
        y: (Math.random() - 0.5) * 2.0,
        z: (Math.random() - 0.5) * 2.0,
      };
      return {
        type,
        chaosPos,
        targetPos,
        color,
        scale,
        currentPos: chaosPos.clone(),
        chaosRotation: new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ),
        rotationSpeed,
      };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === "FORMED";
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x;
      mesh.rotation.y += delta * objData.rotationSpeed.y;
      mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry;
        if (obj.type === 0) geometry = boxGeometry;
        else if (obj.type === 1) geometry = sphereGeometry;
        else geometry = caneGeometry;
        return (
          <mesh
            key={i}
            scale={[obj.scale, obj.scale, obj.scale]}
            geometry={geometry}
            rotation={obj.chaosRotation}
          >
            <meshPhysicalMaterial
              color={obj.color}
              roughness={0.1}
              metalness={0.9}
              emissive={obj.color}
              emissiveIntensity={2.5}
              clearcoat={1}
              clearcoatRoughness={0.1}
              reflectivity={1}
            />
          </mesh>
        );
      })}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3(
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60,
      );
      const h = CONFIG.tree.height;
      const y = Math.random() * h - h / 2;
      const rBase = CONFIG.tree.radius;
      const currentRadius = rBase * (1 - (y + h / 2) / h) + 0.3;
      const theta = Math.random() * Math.PI * 2;
      const [hx, hy, hz] = getHeartPosition();
      const targetPos = new THREE.Vector3(hx, hy, hz);

      const color =
        CONFIG.colors.lights[
          Math.floor(Math.random() * CONFIG.colors.lights.length)
        ];
      const speed = 2 + Math.random() * 3;
      return {
        chaosPos,
        targetPos,
        color,
        speed,
        currentPos: chaosPos.clone(),
        timeOffset: Math.random() * 100,
      };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === "FORMED";
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity =
        (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) {
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
          isFormed ? 3 + intensity * 4 : 0;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial
            color={obj.color}
            emissive={obj.color}
            emissiveIntensity={0}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
};
// -- Name --
const NameTop = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const ref = useRef<THREE.Group>(null);

  useFrame((s, delta) => {
    if (!ref.current) return;

    const base = state === "FORMED" ? 1 : 0;

    // hiệu ứng xuất hiện / biến mất mượt
    ref.current.scale.lerp(new THREE.Vector3(base, base, base), delta * 5);
  });

  return (
    <group ref={ref} position={[0, CONFIG.tree.height / 2 + 4, 0]}>
      <Text
        font="/fonts/GreatVibes-Regular.ttf"
        fontSize={1.4}
        color="#ff5c8a"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#ffffff"
      >
        Trần Ngọc Bảo Châu
      </Text>
    </group>
  );
};

// -- TarotFlyPhoto

const TarotFlyPhoto = ({ active }: { active: boolean }) => {
  const ref = useRef<THREE.Mesh>(null);
  const tex = useTexture("/photos/top.jpg");

  useFrame((_, delta) => {
    if (!ref.current) return;

    const targetZ = active ? 20 : 60;

    ref.current.position.lerp(new THREE.Vector3(0, 0, targetZ), delta * 3);

    const s = active ? 6 : 0;
    ref.current.scale.lerp(new THREE.Vector3(s, s, s), delta * 4);
  });

  return (
    <mesh ref={ref} position={[0, 0, 60]} scale={[0, 0, 0]}>
      <planeGeometry args={[5, 7]} />
      <meshBasicMaterial map={tex} transparent />
    </mesh>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3;
    const innerRadius = 0.7;
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0
        ? shape.moveTo(radius * Math.cos(angle), radius * Math.sin(angle))
        : shape.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.1,
      bevelSegments: 3,
    });
  }, [starShape]);

  // 纯金材质
  const goldMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CONFIG.colors.gold,
        emissive: CONFIG.colors.gold,
        emissiveIntensity: 1.5, // 适中亮度，既发光又有质感
        roughness: 0.1,
        metalness: 1.0,
      }),
    [],
  );

  useFrame((stateObj, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;

      const base = state === "FORMED" ? 1 : 0;

      // nhịp đập nhẹ
      const pulse =
        base * (1 + Math.sin(stateObj.clock.elapsedTime * 2.5) * 0.05);

      groupRef.current.scale.lerp(
        new THREE.Vector3(pulse, pulse, pulse),
        delta * 5,
      );
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({
  sceneState,
  rotationSpeed,
}: {
  sceneState: "CHAOS" | "FORMED";
  rotationSpeed: number;
}) => {
  const [showPhoto, setShowPhoto] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => {
    const show = () => {
      if ((window as any).__pinching !== true) return; // chỉ pinch thật mới zoom
      if (selectedIndex !== null) return;

      setShowPhoto(true);
      setSelectedIndex((window as any).__lockedPhotoIndex ?? 0);
    };

    const hide = () => {
      setShowPhoto(false);
      setSelectedIndex(null);
    };

    window.addEventListener("gesture-photo", show);
    window.addEventListener("gesture-release", hide);

    return () => {
      window.removeEventListener("gesture-photo", show);
      window.removeEventListener("gesture-release", hide);
    };
  }, []);

  const controlsRef = useRef<any>(null);

  useFrame(() => {
    if (controlsRef.current) {
      if (selectedIndex !== null && (window as any).zoomTargetPos) {
        controlsRef.current.target.x = THREE.MathUtils.damp(
          controlsRef.current.target.x,
          (window as any).zoomTargetPos.x,
          6,
          0.016,
        );

        controlsRef.current.target.y = THREE.MathUtils.damp(
          controlsRef.current.target.y,
          (window as any).zoomTargetPos.y,
          6,
          0.016,
        );

        controlsRef.current.target.z = THREE.MathUtils.damp(
          controlsRef.current.target.z,
          (window as any).zoomTargetPos.z,
          6,
          0.016,
        );
      } else {
        // khi release quay target về center galaxy
        controlsRef.current.target.lerp(new THREE.Vector3(0, 0, 0), 0.08);
      }

      const current = controlsRef.current.getAzimuthalAngle();

      // rotationSpeed giờ là targetAngle
      const newAngle = THREE.MathUtils.lerp(current, rotationSpeed, 0.08);

      controlsRef.current.setAzimuthalAngle(newAngle);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={true}
        minDistance={30}
        maxDistance={120}
        autoRotate={rotationSpeed === 0 && sceneState === "FORMED"}
        autoRotateSpeed={0.3}
        maxPolarAngle={Math.PI / 1.7}
      />

      <color attach="background" args={["#000300"]} />
      <Stars
        radius={100}
        depth={50}
        count={5000}
        factor={4}
        saturation={0}
        fade
        speed={1}
      />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight
        position={[30, 30, 30]}
        intensity={100}
        color={CONFIG.colors.warmLight}
      />
      <pointLight
        position={[-30, 10, -30]}
        intensity={50}
        color={CONFIG.colors.gold}
      />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
          <PhotoOrnaments
            state={sceneState}
            showPhoto={showPhoto}
            selectedIndex={selectedIndex}
          />
          <ChristmasElements state={sceneState} />
          <FairyLights state={sceneState} />
          <TopStar state={sceneState} />
          <NameTop state={sceneState} />
        </Suspense>
        <Sparkles
          count={600}
          scale={50}
          size={8}
          speed={0.4}
          opacity={0.4}
          color={CONFIG.colors.silver}
        />
      </group>

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.3}
          luminanceSmoothing={0.1}
          intensity={2.5}
          radius={0.8}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
        );
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
          onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || "MODEL FAILED"}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
          const results = gestureRecognizer.recognizeForVideo(
            videoRef.current,
            Date.now(),
          );
          const ctx = canvasRef.current.getContext("2d");
          if (ctx && debugMode) {
            ctx.clearRect(
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height,
            );
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            if (results.landmarks)
              for (const landmarks of results.landmarks) {
                const drawingUtils = new DrawingUtils(ctx);
                drawingUtils.drawConnectors(
                  landmarks,
                  GestureRecognizer.HAND_CONNECTIONS,
                  { color: "#FFD700", lineWidth: 2 },
                );
                drawingUtils.drawLandmarks(landmarks, {
                  color: "#FF0000",
                  lineWidth: 1,
                });
              }
          } else if (ctx && !debugMode)
            ctx.clearRect(
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height,
            );

          if (results.gestures.length > 0) {
            // ===== NO HAND DETECT =====
            if (results.landmarks.length === 0) {
              (window as any).__pinching = false;

              window.dispatchEvent(new CustomEvent("gesture-release"));

              onMove(0);

              if (debugMode) onStatus("NO HAND DETECTED");

              requestRef = requestAnimationFrame(predictWebcam);
              return;
            }

            const name = results.gestures[0][0].categoryName;
            const score = results.gestures[0][0].score;
            if (score > 0.4) {
              if (name === "Open_Palm") onGesture("CHAOS");
              if (name === "Closed_Fist") onGesture("FORMED");
              if (debugMode) onStatus(`DETECTED: ${name}`);
            }
            if (results.landmarks.length > 0) {
              const hand = results.landmarks[0];

              const index = hand[8]; // ngón trỏ
              const thumb = hand[4]; // ngón cái

              // rotate
              // tay trái phải -> góc quay trái đất
              const targetAngle = (0.5 - index.x) * Math.PI * 2;
              onMove(targetAngle);

              // vertical tilt
              const vertical = (0.5 - index.y) * 0.5;

              window.dispatchEvent(
                new CustomEvent("gesture-vertical", { detail: vertical }),
              );

              // pinch zoom
              const dx = index.x - thumb.x;
              const dy = index.y - thumb.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              // pinch detect -> show photo
              const wasPinching = (window as any).__pinching || false;

              // ngưỡng pinch rõ ràng hơn
              const isPinching = distance < 0.055;
              const isRelease = distance > 0.075;

              // START pinch
              if (isPinching && !wasPinching) {
                (window as any).__pinching = true;

                (window as any).__lockedPhotoIndex =
                  (window as any).nearestPhotoIndex ?? 0;

                window.dispatchEvent(new CustomEvent("gesture-photo"));
              }

              // RELEASE pinch (chỉ cần tách 2 ngón)
              if (isRelease && wasPinching) {
                (window as any).__pinching = false;
                window.dispatchEvent(new CustomEvent("gesture-release"));
              }

              window.dispatchEvent(
                new CustomEvent("gesture-zoom", { detail: distance }),
              );
            }
          } else {
            onMove(0);
          }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode]);

  return (
    <>
      <video
        ref={videoRef}
        style={{
          opacity: debugMode ? 0.6 : 0,
          position: "fixed",
          top: 0,
          right: 0,
          width: debugMode ? "320px" : "1px",
          zIndex: debugMode ? 100 : -1,
          pointerEvents: "none",
          transform: "scaleX(-1)",
        }}
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: debugMode ? "320px" : "1px",
          height: debugMode ? "auto" : "1px",
          zIndex: debugMode ? 101 : -1,
          pointerEvents: "none",
          transform: "scaleX(-1)",
        }}
      />
    </>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  // -- AutoPlay Music
  useEffect(() => {
    const audio = new Audio("/music.mp3");
    audio.loop = true;
    audio.volume = 0.6;

    // autoplay workaround (browser yêu cầu interaction)
    const play = () => {
      audio.play();
      window.removeEventListener("click", play);
    };

    window.addEventListener("click", play);

    return () => {
      window.removeEventListener("click", play);
      audio.pause();
    };
  }, []);

  const [sceneState, setSceneState] = useState<"CHAOS" | "FORMED">("CHAOS");
  const [targetState, setTargetState] = useState<"CHAOS" | "FORMED">("CHAOS");
  useEffect(() => {
    const t = setTimeout(() => {
      setSceneState(targetState);
    }, 300); // delay để animation chuyển từ từ

    return () => clearTimeout(t);
  }, [targetState]);

  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 1,
        }}
      >
        <Canvas
          dpr={[1, 2]}
          gl={{ toneMapping: THREE.ReinhardToneMapping }}
          shadows
        >
          <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} />
        </Canvas>
      </div>
      <GestureController
        onGesture={setTargetState}
        onMove={setRotationSpeed}
        onStatus={setAiStatus}
        debugMode={debugMode}
      />

      {/* UI - Stats */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          left: "40px",
          color: "#888",
          zIndex: 10,
          fontFamily: "sans-serif",
          userSelect: "none",
        }}
      >
        <div style={{ marginBottom: "15px" }}>
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            Memories
          </p>
          <p
            style={{
              fontSize: "24px",
              color: "#FFD700",
              fontWeight: "bold",
              margin: 0,
            }}
          >
            {CONFIG.counts.ornaments.toLocaleString()}{" "}
            <span
              style={{ fontSize: "10px", color: "#555", fontWeight: "normal" }}
            >
              POLAROIDS
            </span>
          </p>
        </div>
        <div>
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            Foliage
          </p>
          <p
            style={{
              fontSize: "24px",
              color: "#004225",
              fontWeight: "bold",
              margin: 0,
            }}
          >
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K{" "}
            <span
              style={{ fontSize: "10px", color: "#555", fontWeight: "normal" }}
            >
              EMERALD NEEDLES
            </span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          right: "40px",
          zIndex: 10,
          display: "flex",
          gap: "10px",
        }}
      >
        <button
          onClick={() => setDebugMode(!debugMode)}
          style={{
            padding: "12px 15px",
            backgroundColor: debugMode ? "#FFD700" : "rgba(0,0,0,0.5)",
            border: "1px solid #FFD700",
            color: debugMode ? "#000" : "#FFD700",
            fontFamily: "sans-serif",
            fontSize: "12px",
            fontWeight: "bold",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          {debugMode ? "HIDE DEBUG" : "🛠 DEBUG"}
        </button>
        <button
          onClick={() =>
            setSceneState((s) => (s === "CHAOS" ? "FORMED" : "CHAOS"))
          }
          style={{
            padding: "12px 30px",
            backgroundColor: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255, 215, 0, 0.5)",
            color: "#FFD700",
            fontFamily: "serif",
            fontSize: "14px",
            fontWeight: "bold",
            letterSpacing: "3px",
            textTransform: "uppercase",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          {sceneState === "CHAOS" ? " Play Music " : " Play Music "}
        </button>
      </div>

      {/* UI - AI Status */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          color: aiStatus.includes("ERROR")
            ? "#FF0000"
            : "rgba(255, 215, 0, 0.4)",
          fontSize: "10px",
          letterSpacing: "2px",
          zIndex: 10,
          background: "rgba(0,0,0,0.5)",
          padding: "4px 8px",
          borderRadius: "4px",
        }}
      >
        {aiStatus}
      </div>
    </div>
  );
}
