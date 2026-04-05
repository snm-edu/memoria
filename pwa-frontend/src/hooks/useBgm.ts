import { useSyncExternalStore, useCallback } from 'react';
import { bgm, type BgmTrack } from '../services/bgm';

/**
 * BGM を React コンポーネントから操作するフック
 *
 * useSyncExternalStore でシングルトンの状態を購読し、
 * ミュートトグル / トラック切り替えを提供する。
 */
export function useBgm() {
  // BgmManager の状態を購読
  const isMuted = useSyncExternalStore(
    (cb) => bgm.subscribe(cb),
    () => bgm.isMuted
  );

  const currentTrack = useSyncExternalStore(
    (cb) => bgm.subscribe(cb),
    () => bgm.track
  );

  const play = useCallback((track: BgmTrack) => {
    bgm.play(track);
  }, []);

  const stop = useCallback(() => {
    bgm.stop();
  }, []);

  const toggleMute = useCallback(() => {
    bgm.toggleMute();
  }, []);

  return { isMuted, currentTrack, play, stop, toggleMute };
}
