/**
 * 物理卡（全局）：重力、弹性、地面摩擦、抛掷力度与两个开关，移动端三项收进折叠。
 *
 * 只改本地状态，随「保存」整包写入；浏览器保存后即时生效，桌面端由保存触发的 Helper 重启重读——
 * physics 在 sprite 构造时只读一次，所以这里不做即时写入。
 * 移动端三项（碰撞震动 / 倾斜重力 / 摇一摇）依赖手机硬件，桌面浏览器上只会静默不生效；
 * 折起来是为了让「拖拽手感」这四个数字占住第一屏，又不把这些开关藏到别的分区去。
 * @module dsh-fish-body/src/client/settings/physics-card
 */
import type { FunctionComponent } from 'react';
import type { PhysicsParams } from '../../shared/types.ts';
import { requestMotionPermission } from '../pet/device-tilt.ts';
import type { DirtyQuery } from './dirty.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

/** 折叠正文的 id：与标题按钮的 `aria-controls` 成对。 */
const MOBILE_BODY_ID = 'pet-cfg-physics-mobile';

/** 物理卡的输入。 */
export interface PhysicsCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  busy: boolean;
  /** 当前物理参数。 */
  physics: PhysicsParams;
  /** 改物理参数的若干字段。 */
  onChange: (patch: Partial<PhysicsParams>) => void;
  /** 未保存改动查询口。 */
  dirty: DirtyQuery;
}

/**
 * 造物理卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export function makePhysicsCard(rt: SettingsRuntime): FunctionComponent<PhysicsCardProps> {
  const { h, t, useState } = rt;

  return function PhysicsCard(props: PhysicsCardProps) {
    const { busy, physics, dirty } = props;
    const { cardHead, field, toggleCell, switchGrid, foldCard } = makeUiKit({ h, t }, dirty);
    const [open, setOpen] = useState(false);

    /** 物理参数的一格：标签在上、数字输入在下。 */
    const physField = (key: 'gravity' | 'restitution' | 'groundFriction' | 'throwPower', step: string, min: string) =>
      field(
        t('physics.' + key),
        h(
          'input',
          numberInputProps(physics[key], (v) => props.onChange({ [key]: v }), { step, min, disabled: busy }),
        ),
        t('physics.' + key + 'Hint'),
        'look.physics.' + key,
      );

    return h('div', {
      className: 'dsh-pet-cfg__group',
      children: [
        h('div', {
          key: 'card',
          className: 'dsh-pet-cfg__card',
          children: [
            cardHead(t('physicsTitle'), t('physicsHint'), 'look.physics'),
            h('div', {
              key: 'numbers',
              className: 'dsh-pet-cfg__grid4',
              children: [
                physField('gravity', '50', '0'),
                physField('restitution', '0.01', '0'),
                physField('groundFriction', '0.1', '0'),
                physField('throwPower', '0.05', '0.05'),
              ],
            }),
            switchGrid([
              toggleCell(
                'physicsCeilingBounce',
                physics.ceilingBounce,
                busy,
                (v) => props.onChange({ ceilingBounce: v }),
                'look.physics.ceilingBounce',
              ),
              toggleCell(
                'physicsPetCollision',
                physics.petCollision,
                busy,
                (v) => props.onChange({ petCollision: v }),
                'look.physics.petCollision',
              ),
            ]),
          ],
        }),
        // 移动端三项：折叠卡自带标题行与问号，展开后才出现开关。
        h(foldCard, {
          key: 'mobile',
          id: MOBILE_BODY_ID,
          title: t('mobileTitle'),
          hint: t('mobileHint'),
          open,
          onToggle: () => setOpen(!open),
          scope: 'look.physics',
          body: [
            switchGrid([
              toggleCell(
                'physicsHaptic',
                physics.hapticEnabled !== false,
                busy,
                (v) => props.onChange({ hapticEnabled: v }),
                'look.physics.hapticEnabled',
              ),
              toggleCell(
                'physicsTilt',
                physics.tiltGravity === true,
                busy,
                (v) => {
                  // iOS 13+ 要求传感器权限必须在用户手势里申请；开关点击正好是那次手势。
                  // 只申请这个开关要用的种类，不顺手把摇一摇的权限也问了。
                  if (v) void requestMotionPermission({ tilt: true, shake: false });
                  props.onChange({ tiltGravity: v });
                },
                'look.physics.tiltGravity',
              ),
              toggleCell(
                'physicsShake',
                physics.shakeThrow === true,
                busy,
                (v) => {
                  if (v) void requestMotionPermission({ tilt: false, shake: true });
                  props.onChange({ shakeThrow: v });
                },
                'look.physics.shakeThrow',
              ),
            ]),
          ],
        }),
      ],
    });
  };
}
