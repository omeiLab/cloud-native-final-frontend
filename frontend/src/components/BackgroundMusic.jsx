import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { publicAssetPath } from '../assets/media';
import useI18n from '../hooks/useI18n';

const MUSIC_URL = publicAssetPath('/music/tsmcsong.mp3');

const BackgroundMusic = () => {
  const { m } = useI18n();
  const audioRef = useRef(null);
  const [enabled, setEnabled] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    const audio = new Audio(MUSIC_URL);
    audio.loop = true;
    audio.volume = 0.35;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const toggleMusic = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (enabled) {
      audio.pause();
      setEnabled(false);
      return;
    }
    try {
      await audio.play();
      setEnabled(true);
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
      setEnabled(false);
    }
  };

  const tip = autoplayBlocked
    ? m.bgm.autoplayBlocked
    : enabled
      ? m.bgm.pause
      : m.bgm.enable;

  return (
    <div className="bgm-control">
      <Tooltip title={tip}>
        <Button
          type={enabled ? 'primary' : 'default'}
          shape="circle"
          icon={enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          aria-label={tip}
          onClick={toggleMusic}
        />
      </Tooltip>
    </div>
  );
};

export default BackgroundMusic;
