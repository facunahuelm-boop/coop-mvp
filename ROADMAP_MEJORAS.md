# Roadmap de Mejoras - UFAMA Sistema

## 🎯 Mejoras Implementadas (Fase Actual)

### 1. ✅ Búsqueda Global
- **Ubicación:** `/buscar`
- **Qué hace:** Permite buscar en tiempo real tareas, compras, documentos, jornadas e incidentes
- **Cómo funciona:** 
  - Mínimo 2 caracteres para buscar
  - Busca en nombre, descripción y otros campos
  - Muestra resultado con tipo, módulo y estado
  - Enlaces directos a cada resultado

### 2. ✅ Reportes Descargables
- **Ubicación:** `/reportes`
- **Reportes disponibles:**
  - 📊 **Reporte de Obra**: Resumen mensual con tareas, avances, problemas, cronograma
  - 💰 **Reporte Financiero**: Ingresos, egresos, presupuesto vs real, saldo disponible
  - 🤝 **Reporte de Jornadas**: Asistencias, horas acumuladas, participación por núcleo
- **Formatos:** PDF y Excel (framework preparado)
- **Historial:** Guarda todos los reportes generados para descarga posterior

### 3. ✅ Notificaciones por Email
- **Ubicación:** `/configuracion`
- **Qué se puede configurar:**
  - Credenciales SMTP (Host, puerto, usuario, contraseña)
  - Email remitente y destino para alertas críticas
  - Tipos de alertas a notificar (tareas atrasadas, documentos vencidos, saldo bajo, problemas críticos)
- **Cómo activar:** 
  1. Ir a Configuración
  2. Ingresar datos del servidor SMTP
  3. Habilitar tipos de alertas deseados
  4. Guardar

### 4. ✅ Identidad Visual UFAMA
- Nombre cambiado en navegación sidebar y topbar
- Preparado para agregar logo cuando esté disponible

---

## 📋 Roadmap Futuro (Fase 2 y 3)

### **Fase 2: Mejoras Técnicas Esenciales**

#### 1. **Generación Real de PDF/Excel** (Prioridad Alta)
```
Instalar: npm install jspdf html2canvas xlsx
Archivos a modificar:
- src/lib/actions/reportes.ts (agregar generación real de PDFs y Excel)
- Crear ruta /api/descargar-reporte/[id] para servir archivos
- Guardar archivos en public/reportes/
- Actualizar archivo_url en BD después de generar
```
**Tiempo estimado:** 4-6 horas

#### 2. **Sistema de Email Automático** (Prioridad Alta)
```
Instalar: npm install nodemailer
Crear: src/lib/email.ts (función para enviar emails)
Crear: src/lib/alertas.ts (trigger automático de alertas por email)
Integrar:
- Cuando se crea una tarea atrasada → email a responsable
- Cuando doc vence → email a administrador
- Cuando saldo baja de umbral → email a tesorería
- Cuando problema crítico se abre → email a comisión
```
**Tiempo estimado:** 6-8 horas

#### 3. **Búsqueda Mejorada con Filtros** (Prioridad Media)
- Agregar filtros por:
  - Fecha (desde/hasta)
  - Estado (completada, pendiente, etc.)
  - Módulo específico
  - Responsable / Autor
- Resultados paginados (max 50 por página)

#### 4. **Backup Automático** (Prioridad Alta)
```
Crear: scripts/backup.mjs
- Backup diario de data/coop.db
- Guardar en carpeta backups/ o cloud (ej: Dropbox, Google Drive)
- Retener últimos 30 backups
- Ejecutar con Node cron: node scripts/backup.mjs
```

---

### **Fase 3: Mejoras de Experiencia**

#### 1. **Análisis de Fotos por IA**
- Cuando se sube foto en incidente de seguridad, Claude analiza y genera "asistencia preliminar"
- Requiere: `ANTHROPIC_API_KEY`
- Nota: Siempre aclarar que no reemplaza evaluación del responsable

#### 2. **Historial Completo de Cambios**
- Para cada tarea, mostrar quién cambió qué y cuándo
- Implementar con tabla `cambios_tarea` (tabla de auditoría por entidad)
- Timeline visual de cambios

#### 3. **Predicción de Fecha de Fin**
- Algoritmo que analiza ritmo actual de tareas completadas
- Calcula fecha estimada de finalización considerando:
  - Velocidad actual (tareas por semana)
  - Tareas pendientes
  - Dependencias
- Mostrar en semáforo de obra

#### 4. **Búsqueda Semántica en Documentos (RAG)**
- Indexar PDFs y documentos largos
- Buscar por contenido, no solo título
- IA responde preguntas consultando contenido real del documento
- Installar: npm install pdf-parse

#### 5. **Alertas por SMS**
- Además de email, enviar SMS para alertas críticas
- Proveedor: Twilio o similar
- Configurar en `/configuracion`

---

## 🛠️ Por Ahora: Setup e Instalación

Para aprovechar las nuevas features de Reportes y Email, necesitás:

### **Paso 1: Recrear la base de datos** (para agregar nuevas tablas)
```bash
# El script seed ya crea las nuevas tablas, pero si quieres limpiar:
npm run seed
```

### **Paso 2: Probar Búsqueda**
- Ir a Búsqueda en el menú
- Buscar algo como "Hierro" o "tarea"
- Deberías ver resultados de todos los módulos

### **Paso 3: Probar Reportes**
- Ir a Reportes
- Hacer clic en "PDF" o "Excel" para algún reporte
- Se guarda en la BD (por ahora sin archivo descargable, pero el framework está listo)
- Para descargas reales de PDF/Excel, hay que hacer Fase 2

### **Paso 4: Configurar Email (Opcional)**
- Ir a Configuración (solo para Admin/Consejo)
- Ingresar datos SMTP de un email (ej: Gmail)
- Guardar
- El sistema está listo para enviar emails en Fase 2

---

## 💡 Ideas Adicionales para Explorar

1. **Integración con Google Drive**: Guardar documentos en Drive en lugar de local
2. **Notificaciones Push**: App mobile que notifique alertas en tiempo real
3. **Gráficos de Progreso**: Visualizar avance de obra, gastos vs presupuesto en gráficos
4. **Exportar a Contabilidad**: Enviar movimientos a software contable (Alegra, Pyme)
5. **Sincronización Multi-usuario**: Modo colaborativo para editar tareas simultáneamente
6. **Integración con Calendario**: Importar jornadas a Google Calendar / Outlook
7. **Propuestas Automáticas de Compra**: ML que sugiere mejores proveedores basado en histórico
8. **Análisis de Productividad**: Reportes sobre rendimiento por núcleo, horas vs objetivos

---

## 🚀 Próximos Pasos Recomendados

1. **Hoy/Mañana:** Explorar las nuevas features (Búsqueda, Reportes, Configuración)
2. **Esta semana:** 
   - Agregar logo de UFAMA en `/public/icon.svg`
   - Cambiar datos de ejemplo por datos reales
3. **Próximas 2 semanas (Fase 2):**
   - Implementar generación real de PDF/Excel
   - Activar email automático
   - Hacer backup automático

---

## 📞 Soporte Técnico

Para implementar cualquiera de estas mejoras, contacta con el equipo técnico.

**Última actualización:** Agosto 2026
**Versión:** MVP 1.1 (con Búsqueda, Reportes, Configuración)
