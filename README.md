# Serene Sanctuary

necesito crear un sitio de un centro de estetica (SPA) con obviamente la vista del cliente donde podra ver los servicios, sacar turno, elegir dia y hora y seguramente podra elegir a la profesional que quiere que lo atienda. Estara la posibilidad de abonar en el momento o solo sacar turno, no lo hable con el cliente aun. el cliene tendra un perfil con sus datos y su historial de servicios a los que fue, y los proximos turnos pendientes.
esto lo bascico del cliente.
despues tenemos la vista del admin donde podra crear y publicar esos servicios, estara la disponibilidad del prodcuto, habra un recuento del stock de cremas y lociones, habra un calendario donde figuraran todos los turnos del mes.
una vista de clientes, otr de profesionales, seguramente las profesionales no esten todo el dia, y no den todos los servicios, seguramente hayan algunas para casos especificos y en horarios especificos.
hasta ahi lo que puedo recordar

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://beauty-appt-planner.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b276d7f3-430a-4353-809b-21f446ed18b9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

> **Nota (21/8/2026).** Eso ya no alcanza: el proyecto dejó de usar Supabase y
> la base ahora corre en Docker, así que `npm run dev` levanta el sitio pero sin
> nada que leer. El arranque real es:
>
> ```sh
> docker compose -f docker-compose.dev.yml up     # http://localhost:8081
> ```
>
> La guía completa está en [`DOCKER.md`](DOCKER.md) y el estado del proyecto en
> [`ESTADO.md`](ESTADO.md).
