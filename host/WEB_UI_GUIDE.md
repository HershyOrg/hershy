# Host Web UI Guide

Web-based visualization interface for Hersh Host server.

## Overview

The Host Web UI provides a user-friendly interface to manage and monitor programs deployed on the Host server. Built with React and integrated directly into the Host binary, it offers real-time monitoring and control of containerized applications.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (http://localhost:9000/ui/programs)    │
└──────────────────┬──────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │  Host Server:9000 │
         │   - JSON API      │
         │   - Web UI        │
         └─────────┬─────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
Program:19001  Program:19002  Program:19003
(WatcherAPI)   (WatcherAPI)   (WatcherAPI)
```

**URL Structure**:
- `/ui/programs` - Dashboard (program list)
- `/ui/programs/:id` - Program Detail (lifecycle control)
- `/ui/programs/:id/watcher` - Watcher Page (WatcherAPI interface)
- `/programs/*` - JSON API endpoints (unchanged)

## Features

### 1. Dashboard (`/ui/programs`)

**Purpose**: Overview of all deployed programs

**Features**:
- Program list with real-time status
- Search and filter capabilities
- Quick action buttons (Start, Stop, Delete)
- Create new program modal

**API Endpoints Used**:
- `GET /programs` - List all programs (polling: 5s)
- `POST /programs` - Create new program
- `POST /programs/:id/start` - Start program
- `POST /programs/:id/stop` - Stop program
- `POST /programs/:id/restart` - Restart program
- `DELETE /programs/:id` - Delete program

**State Colors**:
- **Created**: Gray
- **Building**: Yellow
- **Built**: Blue
- **Starting**: Cyan
- **Running**: Green
- **Stopped**: Red
- **Failed**: Red

### 2. Program Detail (`/ui/programs/:id`)

**Purpose**: Detailed information and lifecycle control for a single program

**Features**:
- Full program metadata display
- Lifecycle control buttons (Start, Stop, Restart, Delete)
- Error message display
- Navigation to Watcher interface

**API Endpoints Used**:
- `GET /programs/:id` - Get program details (polling: 5s)
- `POST /programs/:id/start` - Start program
- `POST /programs/:id/stop` - Stop program
- `POST /programs/:id/restart` - Restart program
- `DELETE /programs/:id` - Delete program

### 3. Watcher Page (`/ui/programs/:id/watcher`)

**Purpose**: Real-time monitoring and control of program's internal Watcher state

**Features**:
- **Status Card**: Watcher runtime status, uptime, state
- **Signal Card**: VarSig, UserSig, WatcherSig metrics
- **Log Viewer**: Effect logs, Reduce logs, Error logs, Context logs
- **Command Panel**: Send messages to program via WatcherAPI

**API Endpoints Used** (via proxy):
- `GET /programs/:id/proxy/watcher/status` - Watcher status (polling: 2s)
- `GET /programs/:id/proxy/watcher/signals` - Signal metrics (polling: 2s)
- `GET /programs/:id/proxy/watcher/logs` - Watcher logs (polling: 2s)
- `POST /programs/:id/proxy/watcher/message` - Send command message

**Quick Commands** (example for trading-long):
- `status` - Print current status
- `portfolio` - Show portfolio details
- `trades` - Show recent trades
- `prices` - Show current prices

## Building and Deployment

### Development Mode

**Prerequisites**:
- bun (JavaScript runtime)
- Node.js (for React development)

**Steps**:
```bash
cd host/api/web
bun install
bun run dev
```

Access dev server at: `http://localhost:5173`

### Production Build

**Prerequisites**:
- bun
- Go 1.24+

**Steps**:

1. Build React production bundle:
```bash
cd host/api/web
bun run build
```

This creates optimized files in `dist/`:
- `index.html`
- `assets/index-*.js`
- `assets/index-*.css`

2. Build Host server (embeds UI):
```bash
cd host
go build -o host-server ./cmd/main.go
```

The `go:embed` directive in `api/web_ui.go` automatically includes `web/dist/*` files.

3. Run Host server:
```bash
./host-server
# or with custom port
./host-server -port 9000
```

**Access**:
- Web UI: `http://localhost:9000/ui/programs`
- JSON API: `http://localhost:9000/programs`

### File Structure

```
host/
├── cmd/
│   └── main.go              # Host server entry point
├── api/
│   ├── server.go            # Host API server
│   ├── handlers.go          # API endpoint handlers
│   ├── web_ui.go            # Web UI serving logic
│   └── web/                 # React application
│       ├── src/
│       │   ├── api/         # API client layer
│       │   │   ├── types.ts
│       │   │   ├── client.ts
│       │   │   ├── host.ts
│       │   │   └── watcher.ts
│       │   ├── components/  # React components
│       │   │   ├── ProgramCard.tsx
│       │   │   ├── FilterBar.tsx
│       │   │   ├── CreateProgramModal.tsx
│       │   │   ├── StatusCard.tsx
│       │   │   ├── SignalCard.tsx
│       │   │   ├── LogViewer.tsx
│       │   │   └── CommandPanel.tsx
│       │   ├── pages/       # Route pages
│       │   │   ├── Dashboard.tsx
│       │   │   ├── ProgramDetail.tsx
│       │   │   └── WatcherPage.tsx
│       │   ├── lib/
│       │   │   └── query.ts # React Query config
│       │   ├── main.tsx     # React Router setup
│       │   └── index.css    # Tailwind styles
│       ├── dist/            # Production build output
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── tsconfig.json
└── host-server              # Compiled binary (includes embedded UI)
```

## Technology Stack

### Frontend
- **React 19**: UI framework
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server
- **TanStack Query**: Data fetching, caching, polling
- **React Router**: Client-side routing
- **Tailwind CSS v4**: Utility-first styling
- **Axios**: HTTP client

### Backend Integration
- **Go embed.FS**: Static file embedding
- **net/http**: HTTP server and routing
- **SPA routing**: All non-asset requests serve `index.html`

## Configuration

### React Router

`basename="/ui/programs"` ensures all client-side routes work correctly when served from `/ui/programs/*`.

### Polling Strategy

**Dashboard**: 5 seconds
- Program list updates
- Balances freshness with server load

**Watcher Page**: 2 seconds
- Status, signals, logs
- Real-time monitoring feel

**React Query Configuration** (`src/lib/query.ts`):
```typescript
{
  refetchOnWindowFocus: false,
  retry: 1,
  staleTime: 2000,
}
```

### API Client

**Base URLs**:
- Host API: `http://localhost:9000`
- WatcherAPI: `http://localhost:9000/programs/:id/proxy`

**Timeout**:
- Host API: 10s
- WatcherAPI: 5s

## Customization

### Adding New Quick Commands

Edit `src/components/CommandPanel.tsx`:

```typescript
const quickCommands = [
  { label: 'Status', value: 'status' },
  { label: 'Your Command', value: 'your-command' },
  // ...
]
```

Then handle in your program's `Manage()` function:

```go
if msg.Content == "your-command" {
    // Handle command
}
```

### Styling

**Color Palette** (defined in `src/index.css`):
- Background: White (light) / Dark gray (dark)
- Primary: Dark blue
- Secondary: Light gray
- Success: Green
- Warning: Yellow
- Error/Destructive: Red

**Modify Colors**:
Edit CSS variables in `src/index.css`:

```css
:root {
  --color-primary: oklch(22.4% 0.048 222.2);
  /* ... */
}
```

### Adding New Pages

1. Create page component in `src/pages/`
2. Add route in `src/main.tsx`:

```typescript
<Route path="/your-route" element={<YourPage />} />
```

3. Add API functions in `src/api/` if needed

## Troubleshooting

### Build Errors

**Error**: `tailwindcss: Cannot apply unknown utility class`

**Solution**: Ensure using `@tailwindcss/postcss` package (Tailwind v4)

```bash
bun add @tailwindcss/postcss
```

Update `postcss.config.js`:
```javascript
{
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

**Error**: `go:embed: pattern ../web/dist: invalid pattern syntax`

**Solution**: `go:embed` cannot use `..` paths. Ensure `web` directory is inside `api` package.

### Runtime Issues

**UI not loading**:
1. Check `dist/` directory exists: `ls host/api/web/dist`
2. Rebuild UI: `cd host/api/web && bun run build`
3. Rebuild server: `cd host && go build ./cmd/main.go`

**API calls failing**:
1. Check Host server running: `curl http://localhost:9000/programs`
2. Check program proxy URL: Program must be in "Running" state
3. Check browser console for CORS/network errors

**Watcher Page shows "Program Not Running"**:
- Program must be in "Running" state
- Start program from Dashboard or Program Detail page

## Performance Considerations

**Polling Optimization**:
- Disable polling for inactive tabs (React Query default)
- Use `staleTime` to prevent redundant requests
- Consider WebSocket for real-time updates (future enhancement)

**Bundle Size**:
- Production build: ~330KB JS (gzip: ~103KB)
- CSS: ~26KB (gzip: ~6KB)
- Total: ~356KB (gzip: ~109KB)

**Caching**:
- Static assets cached with content hash in filename
- `index.html` served fresh (no cache)
- API responses controlled by React Query

## Security Considerations

**Same-Origin Policy**:
- UI and API served from same host:port
- No CORS configuration needed

**WatcherAPI Proxy**:
- Containers bind to `127.0.0.1` only
- Accessible only via Host proxy
- Port 8080 blocked from external access

**Input Validation**:
- Dockerfile and source files validated server-side
- Client-side validation for UX only

## Future Enhancements

**Possible Improvements**:
- WebSocket for real-time updates (eliminate polling)
- Log streaming with filtering and search
- Program resource usage charts (CPU, memory)
- Multi-tenant authentication and authorization
- Deployment wizard with templates
- Program health history and metrics
- Dark mode toggle
- Export logs and metrics to CSV/JSON

## API Coverage

**All 11 Host API endpoints utilized**:

| Endpoint | Dashboard | Program Detail | Watcher Page |
|----------|-----------|----------------|--------------|
| `GET /programs` | ✅ | - | - |
| `POST /programs` | ✅ | - | - |
| `GET /programs/:id` | - | ✅ | ✅ (header) |
| `POST /programs/:id/start` | ✅ | ✅ | - |
| `POST /programs/:id/stop` | ✅ | ✅ | - |
| `POST /programs/:id/restart` | ✅ | ✅ | - |
| `DELETE /programs/:id` | ✅ | ✅ | - |
| `GET .../proxy/watcher/status` | - | - | ✅ |
| `GET .../proxy/watcher/logs` | - | - | ✅ |
| `GET .../proxy/watcher/signals` | - | - | ✅ |
| `POST .../proxy/watcher/message` | - | - | ✅ |

**Coverage**: 11/11 (100%)

## Example Usage

### Deploying a Program

1. Open Dashboard: `http://localhost:9000/ui/programs`
2. Click "Create Program"
3. Fill in form:
   - User ID: `test-user`
   - Dockerfile: (paste your Dockerfile)
   - Source Files: (JSON with file contents)
4. Click "Create Program"
5. Wait for "Building" → "Built" state
6. Click "Start" to run program
7. Click "Open Watcher" (when Running) for detailed monitoring

### Monitoring a Running Program

1. Navigate to Watcher Page: `/ui/programs/:id/watcher`
2. View real-time status in Status Card
3. Monitor signals in Signal Card
4. Check logs in Log Viewer
5. Send commands via Command Panel:
   - Type command or use quick buttons
   - View response in Docker logs or program output

### Sending Messages

From UI:
```
1. Go to Watcher Page
2. Enter command in Command Panel
3. Click "Send" or use quick command button
```

From curl:
```bash
# Get proxy URL
PROXY_URL=$(curl -s http://localhost:9000/programs/your-program-id | jq -r '.proxy_url')

# Send message
curl -X POST $PROXY_URL/watcher/message \
  -H "Content-Type: application/json" \
  -d '{"content":"status"}'

# Check program logs
docker logs <container_id>
```

## Support

For issues or questions:
1. Check this guide's Troubleshooting section
2. Review [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) for Host API details
3. Check [TEST_REPORT_PHASE7-11.md](../TEST_REPORT_PHASE7-11.md) for integration testing results
4. File issue in GitHub repository
