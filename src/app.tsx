import 'reflect-metadata';
import 'moment/locale/zh-cn';
import moment from 'moment';
import { configure } from '@rsjs/core';
import './app.less';
import React from 'react';
import { Button, ConfigProvider, Result } from 'antd';
import { HistoryService } from './services/historyService';
import { getService } from '@rsjs/core';
import zhCN from 'antd/es/locale/zh_CN';
import qs from 'query-string';

configure({
  useProxies: 'always',
  enforceActions: 'never',
});
(window as any).moment = moment;
moment.locale('zh-cn');
// 运行时配置

// 全局初始化数据配置，用于 Layout 用户信息和权限初始化
// 更多信息见文档：https://next.umijs.org/docs/api/runtime-config#getinitialstate
export async function getInitialState(): Promise<{ name: string }> {
  return { name: '@umijs/max' };
}

class ErrorWrap extends React.Component<any> {
  state = {
    showError: false,
    msg: '',
  };
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(error);
    console.log(errorInfo);
    this.setState({
      showError: true,
      msg: errorInfo.componentStack,
    });
  }

  render() {
    return this.state.showError ? (
      <Result
        status="500"
        title="发生异常"
        subTitle={this.state.msg}
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        }
      />
    ) : (
      this.props.children
    );
  }
}

export function rootContainer(container: any, { history }: any) {
  getService<HistoryService>(HistoryService).location = history.location;
  getService<HistoryService>(HistoryService).query = qs.parse(
    history.location.search,
  );
  // const ss = getService<SocketService>(SocketService);
  // ss.client.
  return (
    <div className="wrapper">
      <ErrorWrap>
        <ConfigProvider locale={zhCN}>
          <div className="container">{container}</div>
        </ConfigProvider>
      </ErrorWrap>
    </div>
  );
}
