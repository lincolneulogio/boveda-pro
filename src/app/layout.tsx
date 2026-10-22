import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Bóveda Pro — gestor privado de contraseñas",
  description:
    "Aplicación de escritorio para gestionar contraseñas cifradas localmente.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
