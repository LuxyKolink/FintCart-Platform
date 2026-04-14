# Marco Tecnológico

## 1.1. NestJS Framework

El componente de servicio de aprendizaje, responsable de la administración del contenido educativo, se va a implementar a partir del uso del framework NestJS; este framework está soportado a partir del conjunto de herramientas del lenguaje TypeScript, y utiliza patrones de arquitectura inspirados en AngularJS.

NestJS provee documentación y soporte para la construcción y diseño de microservicios a través del uso de inyección de dependencias; además, su estructura se alinea con los requerimientos para la gestión del contenido educativo en la aplicación, los cuales permiten la separación de responsabilidades entre los componentes del sistema. NestJS también ofrece soporte para el protocolo gRPC, el cual se constituye como el canal de comunicación principal entre los diferentes microservicios a implementar dentro del sistema.

## 1.2. gRPC para Comunicación de Alto Rendimiento

La comunicación entre servicios incorpora la implementación del protocolo gRPC, el cual pertenece al framework del llamado a procedimiento remoto (RPC), permite manejar operaciones de alto rendimiento y es flexible bajo cualquier entorno de desarrollo y lenguaje de programación.

gRPC utiliza protocol buffers como el formato de mensajes, los cuales permiten reducir la sobrecarga de trabajo de red comparado con protocolos basados en formato JSON (API REST); esto representa una ventaja en cuanto a la frecuencia en la comunicación entre los servicios y componentes del sistema. La comunicación gRPC aplica exclusivamente entre servicios internos del sistema; la aplicación frontend se comunica con el servidor de aplicación únicamente a través de HTTP/REST.

## 1.3. Lenguaje de Programación Go

Los componentes correspondientes al servidor de aplicación, servidor de autenticación, orquestador, servicio de usuarios y servicio de auditoría se implementarán bajo el lenguaje de programación Go, el cual ofrece características favorables con respecto a rendimiento y soporte para operaciones concurrentes; es comúnmente usado para la creación de servicios que se manejan a través del uso simultáneo de sesiones de usuario.

El modelo de concurrencia integrado del lenguaje, basado en canales y goroutines, provee soluciones para el manejo de peticiones múltiples de usuarios de forma simultánea. La compilación de binarios nativos elimina las dependencias de ejecución y reduce la complejidad del despliegue. Además, el lenguaje posee soporte para librerías encargadas del manejo de servidores HTTP, procesamiento de formato JSON, conexiones a bases de datos y comunicación gRPC, entre otros.

## 1.4. Rust

Se utilizará el lenguaje de programación Rust para implementar el servicio de simulación del sistema; el lenguaje Rust está diseñado para tareas de alto rendimiento y seguridad en cuanto a la programación del lenguaje, además también posee soporte para realizar operaciones concurrentes.

Rust previene errores comunes de la programación, como lo son los punteros nulos, sobrecarga de buffers, y manejo de tiempos de compilación en comparación con los tiempos de ejecución; estas características son importantes a la hora de realizar cálculos con cierto nivel de complejidad que debe realizar el sistema para entregar resultados de simulación adecuados con alta precisión numérica. Además, Rust ofrece compatibilidad con los demás componentes del sistema a través de su ecosistema de dependencias, permitiendo así la implementación de la comunicación gRPC, pruebas unitarias y operaciones asíncronas.

## 1.5. TypeScript

El lenguaje TypeScript es utilizado en dos componentes del sistema con propósitos distintos. El servicio de notificación, al ser un consumidor puro de eventos RabbitMQ sin lógica de dominio compleja, se implementa en TypeScript puro aprovechando el ecosistema de librerías para mensajería asíncrona disponible en Node.js.

El servicio de aprendizaje se implementa sobre el framework NestJS, el cual está basado en TypeScript y su estándar de desarrollo y arquitectura, dado que la complejidad del dominio de contenido educativo se beneficia de la estructura y los patrones que NestJS provee.

## 1.6. Angular

Se implementará la interfaz gráfica del cliente de la aplicación a través del framework Angular, el cual está basado en TypeScript y su estándar de desarrollo y arquitectura.

A través de la organización de los proyectos implementados con Angular, se facilita la construcción de componentes reutilizables, así como la inyección de dependencias permite la separación de responsabilidades del código entre capas de presentación. Angular también soporta la mantenibilidad del código a través de las interfaces y tipos comunes de datos, y permite diseñar pantallas interactivas a través del soporte de RxJS para el consumo asíncrono de recursos del sistema. La aplicación implementa el flujo OAuth2 con PKCE para la autenticación del usuario contra el servidor de autenticación.

## 1.7. PostgreSQL

PostgreSQL es la base de datos relacional seleccionada para permitir y administrar la persistencia de los datos a través del flujo operacional de la aplicación. Cada microservicio posee su propia base de datos PostgreSQL, siguiendo el patrón de base de datos por servicio (database-per-service), garantizando el aislamiento de datos entre componentes.

PostgreSQL permite mantener la integridad de los datos gracias a su diseño relacional y su funcionalidad principal basada en patrones ACID, además la base de datos permite compatibilidad con registros construidos en formato JSON, el manejo adecuado del pool de conexiones y soporte para la creación de réplicas para operaciones de lectura, lo cual es necesario para el sistema y sus componentes ya que permite alta escalabilidad.

## 1.8. Redis

Redis se incorpora como almacenamiento en memoria para soportar funcionalidades transversales del sistema. Es utilizado por el servidor de autenticación para la gestión de la lista negra de tokens JWT revocados y el almacenamiento de refresh tokens, garantizando la revocación inmediata de sesiones. El servidor de aplicación lo utiliza para la implementación del límite de peticiones (rate limiting) distribuido. Su naturaleza en memoria garantiza latencia mínima en estas operaciones de alta frecuencia.

## 1.9. RabbitMQ

La comunicación asíncrona entre los componentes del sistema se implementa a través del uso de RabbitMQ, un broker de mensajería que implementa el protocolo de cola de mensajes avanzado (AMQP) para la entrega de notificaciones y operaciones dirigidas por eventos entre los microservicios.

Los servicios productores de eventos (usuarios, aprendizaje, orquestador) publican eventos hacia RabbitMQ, el cual los enruta hacia los servicios consumidores correspondientes (notificación, auditoría). Este patrón garantiza el desacoplamiento entre productores y consumidores, permitiendo que cada servicio opere de forma independiente.

## 1.10. Despliegue

Para realizar los procesos principales de despliegue en el sistema y asegurar el adecuado funcionamiento de los servicios, se utiliza Docker para crear diferentes contenedores para cada uno de los servicios. De esta forma se pueden aislar los diferentes componentes entre diferentes entornos de desarrollo, asegurando así el escalamiento y la orquestación adecuada de las operaciones. Cada microservicio, junto con sus dependencias de infraestructura (PostgreSQL, Redis, RabbitMQ), se despliega como un contenedor independiente.

## 1.11. Kubernetes

Para la orquestación y gestión de los contenedores del sistema en entornos de producción se utiliza Kubernetes, el cual permite automatizar el despliegue, escalamiento y administración de los microservicios que componen la plataforma.

Kubernetes complementa el uso de Docker al proveer capacidades de escalamiento horizontal automático de los servicios según la demanda, recuperación ante fallos mediante el reinicio automático de contenedores caídos, y gestión centralizada de la configuración y secretos del sistema. Además, facilita la comunicación entre servicios dentro del clúster y el balanceo de carga entre instancias de un mismo servicio, garantizando la disponibilidad y resiliencia de la plataforma Fintcart en producción.
