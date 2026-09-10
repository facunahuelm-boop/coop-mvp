import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimizaciones de memoria
  onDemandEntries: {
    maxInactiveAge: 15 * 1000, // 15 segundos
    pagesBufferLength: 5,
  },

  // Deshabilitar source maps en desarrollo para ahorrar memoria
  productionBrowserSourceMaps: false,

  // Limitar concurrent compilaciones
  experimental: {
    memoryBasedWorkersCount: true,
  },

  // pdfkit carga sus métricas de fuente (.afm) en tiempo de ejecución con una
  // ruta relativa a __dirname, que el rastreador de archivos de Vercel no
  // detecta solo — sin esto, el reporte en PDF fallaría en producción aunque
  // funcione en desarrollo local.
  outputFileTracingIncludes: {
    "/api/reportes/finanzas": ["./node_modules/pdfkit/js/data/**"],
  },

  // Endurecimiento de seguridad del servidor (pedido explícito: "que quede
  // con mucha seguridad el servidor"). Estos encabezados no cambian nada de
  // lo que la app ya hace — son instrucciones para el navegador de quien
  // visita el sitio, y no tienen forma de romper una pantalla que ya
  // funciona:
  //  - X-Frame-Options / frame-ancestors: nadie puede incrustar el sistema
  //    dentro de un <iframe> de otro sitio (protección contra "clickjacking").
  //  - X-Content-Type-Options: el navegador no intenta "adivinar" el tipo de
  //    un archivo servido (protección contra ataques de MIME-sniffing).
  //  - Referrer-Policy: al hacer clic en un link que sale del sistema hacia
  //    otro sitio, no se le manda la URL completa de origen (que podría
  //    incluir el subdominio de la cooperativa) — solo el dominio.
  //  - Permissions-Policy: apaga cámara/micrófono/ubicación del navegador
  //    para este sitio, que no los usa para nada.
  //  - Strict-Transport-Security: le dice al navegador que, una vez visitado
  //    por HTTPS, no vuelva a intentar por HTTP nunca (evita ataques que
  //    fuerzan una conexión sin cifrar).
  // Deliberadamente no se agrega acá una política CSP (Content-Security-
  // Policy): es la protección más fuerte contra XSS, pero también la más
  // fácil de dejar mal configurada sin poder probarla en vivo contra
  // producción — una CSP mal armada puede romper pantallas enteras. Queda
  // como el siguiente paso recomendado, para hacerlo con margen de probarlo.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
