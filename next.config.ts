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
};

export default nextConfig;
