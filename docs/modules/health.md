# Модуль `health` — проверка живости

Минимальный модуль для health-проверок (используется Docker `HEALTHCHECK` и оркестрацией). Публичный, без аутентификации.

**Слой:** backend (module `health`)
**Статус:** актуально

## Эндпоинт

| Метод / путь | Guard | DTO ответа | Метод | Ответ |
|---------------|-------|------------|--------|-------|
| `GET /health` | публичный | `HealthResponseDto` | `check()` | `{ status: 'ok' }` |

`src/health/health.controller.ts`:

```ts
@Controller('health')
export class HealthController {
  @Get()
  @ZodResponse({ type: HealthResponseDto })
  check() {
    return { status: 'ok' };
  }
}
```

Ответ декорируется `@ZodResponse({ type: HealthResponseDto })`.

## DTO

| Файл | Схема |
|------|-------|
| `src/health/dto/health-response.dto.ts` | `HealthControllerCheckResponse` (`{ status: string }`) — наследует сгенерированную схему |

## Связанные документы

- [README.md](./README.md) — индекс модулей
- [../architecture.md](../architecture.md) — bootstrap, как запускать/тестировать
- [../contracts/rest-api.md](../contracts/rest-api.md) — контракт `HealthController*`
