import { redirect } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { descifrar } from "@/lib/crypto";
import { uriTotp, ROLES_CON_2FA } from "@/lib/totp";
import { obtenerReglamento } from "@/lib/reglamento";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ActivarDosPasosBoton, ConfirmarDosPasosForm, DesactivarDosPasosForm, CerrarOtrasSesionesBoton } from "@/components/cuenta/SeguridadCuentaFormularios";

/** Fase 1E — "Mi seguridad": verificación en dos pasos, sesiones y contraseña. */
export default async function MiSeguridadPage({ searchParams }: { searchParams: Promise<{ obligatorio?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { obligatorio } = await searchParams;
  const [fila, reglamento, org] = await Promise.all([
    get<{ email: string; totp_secreto: string | null; totp_activado_en: string | null; totp_respaldo: string | null }>(
      `SELECT email, totp_secreto, totp_activado_en, totp_respaldo FROM users WHERE id = ?`,
      [user.id]
    ).catch(() => undefined),
    obtenerReglamento(),
    get<{ nombre: string }>(`SELECT nombre FROM organizations WHERE id = ?`, [user.organization_id]),
  ]);
  const sensible = (ROLES_CON_2FA as readonly string[]).includes(user.rol);
  const exigido = sensible && reglamento.seguridad.exigir2fa;
  const activo = !!fila?.totp_activado_en;
  const secretoPendiente = !activo && fila?.totp_secreto ? descifrar(fila.totp_secreto) : null;
  const qr = secretoPendiente ? await QRCode.toDataURL(uriTotp(secretoPendiente, fila!.email, `COOVA ${org?.nombre ?? ""}`.trim()), { margin: 1, width: 220 }) : null;
  const respaldosRestantes = fila?.totp_respaldo ? (JSON.parse(fila.totp_respaldo) as string[]).length : 0;

  return (
    <div className="space-y-5 text-[16px]">
      <PageHeader title="Mi seguridad" subtitle="Cómo entrás a COOVA y cómo proteger tu cuenta" />
      {obligatorio && !activo && (
        <p className="rounded-xl bg-[var(--color-amarillo-bg)] px-4 py-3 text-[16px] text-ink">
          La cooperativa pide que las cuentas de {user.rol === "tesoreria" ? "tesorería" : "conducción"} tengan la verificación en dos pasos. Activala para seguir usando COOVA.
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-ink">Verificación en dos pasos</h2>
          <Badge color={activo ? "verde" : sensible ? "amarillo" : "gray"}>{activo ? "Activada" : exigido ? "Obligatoria para tu rol" : sensible ? "Recomendada para tu rol" : "No activada"}</Badge>
        </div>
        <p className="mt-1 text-ink-muted">
          Además de tu contraseña, al entrar se te pide un código de 6 números que muestra una app en tu celular. Así, aunque alguien sepa tu contraseña, no puede entrar.
        </p>

        {activo ? (
          <div className="mt-4 space-y-3">
            <p className="text-ink">Te quedan {respaldosRestantes} código{respaldosRestantes === 1 ? "" : "s"} de respaldo.</p>
            {!exigido && <DesactivarDosPasosForm />}
          </div>
        ) : secretoPendiente && qr ? (
          <ol className="mt-4 space-y-4 list-decimal pl-5">
            <li>
              Instalá en tu celular una app de verificación: <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong> (son gratis).
            </li>
            <li>
              En la app, tocá «Agregar» y escaneá este código:
              <img src={qr} alt="Código QR para la app de verificación" className="mt-2 h-48 w-48 rounded-lg border border-border bg-white p-1" />
              <p className="mt-2 text-[15px] text-ink-muted">
                ¿No podés escanear? Escribí esta clave en la app: <span className="font-mono text-ink break-all">{secretoPendiente.match(/.{1,4}/g)?.join(" ")}</span>
              </p>
            </li>
            <li>
              Escribí el código de 6 números que te muestra la app:
              <div className="mt-2">
                <ConfirmarDosPasosForm />
              </div>
            </li>
          </ol>
        ) : (
          <div className="mt-4">
            <ActivarDosPasosBoton />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Sesiones abiertas</h2>
        <p className="mt-1 text-ink-muted">¿Entraste desde una computadora prestada o perdiste el celular? Cerrá la sesión en todos los demás lugares. Acá seguís adentro.</p>
        <div className="mt-3">
          <CerrarOtrasSesionesBoton />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-ink">Contraseña</h2>
        <p className="mt-1 text-ink-muted">
          Podés cambiarla desde <Link href={`/usuarios/${user.id}`} className="underline">tu perfil</Link>. Si no la recordás, en la pantalla de ingreso podés pedir un link al email para entrar sin contraseña.
        </p>
      </Card>
    </div>
  );
}
