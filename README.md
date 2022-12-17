# Plume

Plume 是一个可嵌入的无限画布编辑器。`packages/app` 里的演示站只是其中一个宿主。产品里挂载同一个编辑器，把协作指到自己的权威服务。

笔、马克笔、橡皮、图形、文字、便签、标注评论、图片和连接线都在编辑器里。激光笔不进文档，拖过的痕迹大约一秒后消失，其他人能看见。演示会收起工具、适配整张画布，并把镜头通过 presence 提供给别人跟随。右下角的小地图移动镜头。手指平移和双指缩放。触控笔只负责落墨。每个客户端保留自己的镜头。

## 包

`@plume/editor` 是编辑器。它铺满你给它的那一块区域。界面是悬浮的工具条，像一块 iPad 应用放在窗口里。

`@plume/collab` 是步骤传输。`createLocalProvider()` 用 `BroadcastChannel` 和 `navigator.locks` 在当前浏览器里给步骤排序，演示站用的就是它。`createServerProvider({ url, boardId, token })` 把同样的步骤发给 WebSocket 权威服务。账号会话放在 `token` 里。

`@plume/server` 是参考权威服务。它保存步骤日志，并给所有客户端同一个顺序。账号系统就绪后传入 `authorize`。在那之前，连接是匿名的。传入 `dataDir` 后，日志写到该目录，重启后仍在。

`@plume/model` 是文档、步骤和变基。撤销把逆步骤当作一次新事务发出。

```tsx
import { createServerProvider } from '@plume/collab';
import { PlumeEditor } from '@plume/editor';

const collab = createServerProvider({
  url: 'wss://boards.example/plume',
  boardId: roomId,
  token: () => session.accessToken,
});

<PlumeEditor collab={collab} storage={storage} imageProvider={images} userName={user.name} readOnly={!user.canEdit} />
```

`readOnly` 时仍可平移、缩放、适配、导出，也能使用激光笔。`userName` 出现在其他人的光标上，也写进新的评论。演示中的镜头只活在 presence 上，不写进步骤。

`imageProvider` 默认把图片读成 data URL，写在对象的 `src` 上。要把字节放在外面，传入自己的上传函数，返回可以画出来的 URL：

```ts
const images = {
  async upload(file: Blob) {
    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/api/images', { method: 'POST', body });
    const payload = await response.json();
    return payload.url as string;
  },
};
```

```ts
import { createPlumeServer } from '@plume/server';

await createPlumeServer({
  port: 8790,
  dataDir: 'plume-data',
  authorize: async ({ token, boardId }) => {
    const user = await accounts.verify(token);
    if (!user) return { error: 'Sign in required' };
    return { userId: user.id };
  },
});
```

服务端消息是 `hello`、`submit`、`sync`、`presence`、`welcome`、`accepted`、`catchup`、`peers`、`presence` 和 `rejected`。`presence` 只广播光标，不进步骤日志。

## 演示

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

演示站的生产构建在 `packages/app/dist`。资源地址是相对路径。用 HTTP 打开它。直接用 `file://` 打开 `index.html` 时，页面会说明怎样启动静态服务器。

```bash
pnpm preview
pnpm server
```

`pnpm server` 在 8790 端口启动一个匿名权威服务。端口被占用时设置 `PLUME_PORT`。设置 `PLUME_DATA` 为目录后，房间会保存在那里。演示页默认使用本地 Provider。标题旁的 Local / Server 可改成连接 `ws://127.0.0.1:8790`。
