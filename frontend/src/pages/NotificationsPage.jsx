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
            <Title level={3} style={{ marginBottom: 0 }}>Notifications</Title>
            <Paragraph type="secondary">Unread <Badge count={unreadCount} /></Paragraph>
          </div>
          <Space>
            <Button onClick={() => refreshList()}>Refresh</Button>
            <Button type="primary" onClick={markAllRead}>Mark all read</Button>
          </Space>
        </Space>
      </Card>

      <Card style={{ marginTop: 16 }} loading={loading}>
        {items.length === 0 ? (
          <Empty description="No notifications yet" />
        ) : (
          <List
            dataSource={items}
            renderItem={(item) => {
              const cancellationReason = shouldShowCancellationReasonLine(item) ? extractCancellationReason(item) : '';
              return (
                <List.Item
                  actions={[
                    item.read_at ? (
                      <Tag color="default">Read</Tag>
                    ) : (
                      <Button type="link" onClick={() => markRead(item.id)}>Mark read</Button>
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
                            Cancellation reason：{cancellationReason}
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
