import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, List, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useNotifications } from '../context/NotificationContext';
import { extractCancellationReason, shouldShowCancellationReasonLine } from '../utils/notificationDisplay';
import useI18n from '../hooks/useI18n';

const { Title, Paragraph } = Typography;

const NotificationsPage = () => {
  const { items, unreadCount, refreshList, markRead, markAllRead } = useNotifications();
  const { m, NOTIFICATION_TYPE_LABELS, labelOr } = useI18n();
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
            <Title level={3} style={{ marginBottom: 0 }}>{m.notifications.title}</Title>
            <Paragraph type="secondary">{m.notifications.unread} <Badge count={unreadCount} /></Paragraph>
          </div>
          <Space>
            <Button onClick={() => refreshList()}>{m.common.refresh}</Button>
            <Button type="primary" onClick={markAllRead}>{m.notifications.markAllRead}</Button>
          </Space>
        </Space>
      </Card>

      <Card style={{ marginTop: 16 }} loading={loading}>
        {items.length === 0 ? (
          <Empty description={m.notifications.empty} />
        ) : (
          <List
            dataSource={items}
            renderItem={(item) => {
              const cancellationReason = shouldShowCancellationReasonLine(item) ? extractCancellationReason(item) : '';
              return (
                <List.Item
                  actions={[
                    item.read_at ? (
                      <Tag color="default">{m.notifications.read}</Tag>
                    ) : (
                      <Button type="link" onClick={() => markRead(item.id)}>{m.notifications.markRead}</Button>
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
                            {m.notifications.cancellationReason}：{cancellationReason}
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
