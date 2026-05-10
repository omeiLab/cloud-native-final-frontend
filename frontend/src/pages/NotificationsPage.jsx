import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, List, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useNotifications } from '../context/NotificationContext';
import { NOTIFICATION_TYPE_LABELS, labelOr } from '../utils/labels';
import { extractCancellationReason, shouldShowCancellationReasonLine } from '../utils/notificationDisplay';

const { Title, Paragraph } = Typography;

const NotificationsPage = () => {
  const { items, unreadCount, refreshList, markRead, markAllRead } = useNotifications();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    refreshList().finally(() => setLoading(false));
  }, [refreshList]);

  return (
    <div className="page-wrap">
      <Card>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Title level={3} style={{ marginBottom: 0 }}>通知中心</Title>
            <Paragraph type="secondary">未讀 <Badge count={unreadCount} /></Paragraph>
          </div>
          <Space>
            <Button onClick={() => refreshList()}>重新整理</Button>
            <Button type="primary" onClick={markAllRead}>全部已讀</Button>
          </Space>
        </Space>
      </Card>

      <Card style={{ marginTop: 16 }} loading={loading}>
        {items.length === 0 ? (
          <Empty description="目前沒有通知" />
        ) : (
          <List
            dataSource={items}
            renderItem={(item) => {
              const cancellationReason = shouldShowCancellationReasonLine(item) ? extractCancellationReason(item) : '';
              return (
                <List.Item
                  actions={[
                    item.read_at ? (
                      <Tag color="default">已讀</Tag>
                    ) : (
                      <Button type="link" onClick={() => markRead(item.id)}>標記已讀</Button>
                    )
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span>{item.title}</span>
                        <Tag color="blue">{labelOr(NOTIFICATION_TYPE_LABELS, item.type, item.type)}</Tag>
                      </Space>
                    }
                    description={
                      <>
                        <Paragraph style={{ marginBottom: 8 }}>{item.body}</Paragraph>
                        {cancellationReason ? (
                          <Paragraph style={{ marginBottom: 8 }}>
                            取消原因：{cancellationReason}
                          </Paragraph>
                        ) : null}
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          {dayjs(item.created_at).format('YYYY-MM-DD HH:mm:ss')}
                        </Paragraph>
                      </>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
};

export default NotificationsPage;
