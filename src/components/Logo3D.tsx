"use client";

import { useRef, useState } from "react";

// Logo de COOVA (ícono + la palabra "COOVA", sin el renglón de abajo) con
// efecto de profundidad: sombra en capas + una leve inclinación 3D que sigue
// el mouse, para que se sienta como una placa que "flota" en vez de una
// imagen plana pegada a la pantalla. En pantallas táctiles (sin mouse) queda
// con la inclinación de base, que ya alcanza para que se note el efecto.
export function Logo3D({
  src,
  width,
  height,
  alt = "COOVA",
  className = "",
}: {
  src: string;
  width: number;
  height: number;
  alt?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -10, y: px * 14 });
  }
  function handleLeave() {
    setTilt({ x: 0, y: 0 });
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`inline-block ${className}`}
      style={{ perspective: 900 }}
    >
      <div
        className="relative transition-transform duration-150 ease-out motion-reduce:transition-none"
        style={{
          width,
          height,
          transform: `rotateX(${8 + tilt.x}deg) rotateY(${tilt.y}deg)`,
          transformStyle: "preserve-3d",
        }}
      >
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="w-full h-full object-contain select-none pointer-events-none"
          style={{
            filter:
              "drop-shadow(0 14px 22px rgba(18,50,64,0.35)) drop-shadow(0 2px 5px rgba(18,50,64,0.25))",
          }}
          draggable={false}
        />
        {/* brillo sutil que se corre con la inclinación — refuerza que es una placa, no una foto plana */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(${115 + tilt.y * 2}deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0) 40%)`,
            mixBlendMode: "overlay",
          }}
        />
      </div>
    </div>
  );
}
