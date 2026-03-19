# Marco Tecnológico

## 1.1. NestJS Framework

El componente de servicio de aprendizaje, responsable de la administración del contenido educativo, se va a implementar a partir del uso del framework NestJS; este framework esta soportado a partir del conjunto de herramientas del lenguaje Typescript, y utiliza patrones de arquitectura inspirados en AngularJS [https://docs.nestjs.com/microservices/grpc]

NestJS provee documentación y soporte para la construcción y diseño de microservicios a través del uso de inyección de dependencias; además, su estructura se alinea con los requerimientos para la gestión del contenido educativo en la aplicación, los cuales permiten la separación de responsabilidades entre los componentes del sistema.  
NestJS también ofrece soporte para el protocolo gRPC, el cuál se constituye como el canal de comunicación principal entre los diferentes microservicios a implementar dentro del sistema [https://medium.com/@ietienam/building-a-nestjs-api-gateway-with-grpc-microservice-35c900eba85e]

## 1.2. gRPC para comunicación de Alto Rendimiento

La comunicación entre servicios incorpora la implementación del protocolo gRPC, el cuál pertenece al framework del llamado a procedimiento remoto (RPC), permite manejar operaciones de alto rendimiento y es flexible bajo cualquier entorno de desarrollo y lenguaje de programación. [https://medium.com/@souravkodali/nestjs-microservices-using-grpc-as-transporter-cd3d90e54eb5]

gRPC utiliza buffers de protocolo como el formato de mensajes, los cuales permiten reducir la sobrecarga de trabajo de red comparado con protocolos basados en formato JSON (API REST); esto representa una ventaja en cuanto a la frecuencia en la comunicación entre los servicios y componentes del sistema. [https://docs.nestjs.com/microservices/grpc]

## 1.3. Lenguaje de Programación Go

Los componentes correspondientes al servidor de aplicación y el servicio de usuarios se implementarán bajo el lenguaje de programación Go, el cuál ofrece características favorables con respecto a rendimiento y soporte para operaciones concurrentes; es comunmente usado para la creación de servicios que se manejan a través del uso simultaneo de sesiones de usuario. [https://encore.cloud/resources/go-frameworks]

El modelo de concurrencia integrado del lenguaje, basado en canales y gorutinas, provee soluciones para el manejo de peticiones multiples de usuarios de forma simultanea. La compilación de binarios nativos elimina las dependencias de ejecución y reduce la complejidad del despliegue, además, el lenguaje posee soporte para librerías encargadas del manejo de servidores HTTP, procesamiento de formato JSON, y conexiones a bases de datos, entre otros.

## 1.4. Rust

Se utilizará el lenguaje de programación Rust para implementar el servicio de simulación del sistema; el lenguaje Rust esta diseñado para tareas de alto rendimiento y seguridad en cuanto a la programación del lenguaje, además, tambien posee soporte para realizar operaciones concurrentes. [Refs]

Rust previene errores comunes de la programación, como lo son los punteros nulos, sobrecarga de buffers, y manejo de tiempos de compilación en comparación con los tiempos de ejecución; estas características sin importantes a la hora de realizar cálculos con cierto nivel de complejidad que debe realizar el sistema para entregar resultados de simulación adecuados. Además, Rust ofrece compatibilidad con los demás componentes del sistema gracias a su librería e instalador de paquetes para el manejo de dependencias del componente de simulación, permitiendo así la implementación de la comunicación gRPC, pruebas unitarias y operaciones asíncronas.

## 1.5. Angular

Se implementará la interfaz gráfica del cliente de la aplicación a través del Framework Angular, el cuál esta basado en Typescript y su estándar de desarrollo y arquitectura.

A través de la organización de los proyectos implementados con Angular, facilita la construcción de componentes reutilizables, así como la inyección de dependencias permite la separación de responsabilidades del código entre capas de presentación del código contenido en el proyecto.

Angular también soporta la mantenibilidad del código a través de las interfaces y tipos comunes de datos, y permite diseñar pantallas interactivas a través del soporte de RxJS y librerías de comportamiento de componentes para el cargue de contenido de la plataforma a través del consumo de recursos y operaciones de otros componentes del sistema, comprendidos como asincronos en su totalidad.

## 1.6. PostreSQL

PostgreSQL es la base de datos relacional seleccionado para permitir y administrar la persistencia de los datos a través del flujo operacional de la aplicación.

PostgreSQL permite mantener la integridad de los datos gracias a su diseño relacional y su funcionalidad principal basada en patrones ACID [Refs], además, la base de datos permite compatibilidad con registros construidos en formato JSON, el manejo adecuado del pool de conexiones y soporte para la creación de replicas para operaciones de lectura, lo cuál es necesario para el sistema y sus componentes ya que permite alta escalabilidad dentro del sistema.

## 1.7. RabbitMQ

La comunicación asincrona entre los componentes del sistema puede ser implementado a través del uso de RabbitMQ, se trata de un broker de mensajería que implementa el protocolo de cola de mensajes avanzado (AMQP) para la entrega de notificaciones y operaciones dirigida por eventos entre el cliente y la orquestración de operaciones entre multiples servicios. [Refs]

Esto sugiere una implementación de patrones de mensajería en el sistema, esto se realiza con el propósito de notificar al usuario sobre operaciones o funcionalidades que requiera conocer sobre su estado y bajo el contexto de varios escenarios dentro de las rutas operacionales de la aplicación.

## 1.8. Despliegue

Para realizar los procesos principales de despliegue en el sistema y asegurar el adecuado funcionamiento de los servicios, se utiliza Docker para crear diferentes contenedores para cada uno de los servicios, de esta forma se pueden isolar los diferentes componentes entre diferentes entornos de desarrollo, asegurando así el escalamiento y la orquestación adecuada de las operaciones. [https://www.atlassian.com/microservices/microservices-architecture/docker]
